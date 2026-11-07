/**
 * LOKET — single-service gateway for Railway.
 *
 *   /                     public config generator (rate limited, no password)
 *   /admin                admin monitor (ADMIN_PASS, session + csrf)
 *   /health               liveness
 *   /api/public/signup    create an account, return ready-to-paste configs
 *   /api/admin/*          users + ip monitoring, block/unblock
 *   /ssh-ws /vless-ws /trojan-ws   websocket gateways
 */
'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const { WebSocketServer } = require('ws');

const net = require('node:net');
const { Sessions, Throttle, hashPassword, verifyPassword } = require('./auth');
const { Users } = require('./users');
const { Usage } = require('./usage');
const { attachSsh } = require('./ssh-ws');
const { attachVless } = require('./vless');
const { tailDropbear } = require('./ssh-log');
const { isPrivateIp } = require('./net-guard');
const { publicPage, adminPage, qrSvg } = require('./ui');
const { loadNodes, probeNode } = require('./nodes');
const { openEgress } = require('./upstream');
const { parseRawProxies, scanAndFilter } = require('./scanner');

const CONFIG = {
  port: Number(process.env.WEB_PORT || process.env.PORT || 8080),
  sshPort: Number(process.env.SSH_PORT || 22),
  sshHost: process.env.SSH_HOST || '127.0.0.1',
  sshPath: process.env.SSH_WS_PATH || '/ssh-ws',
  vlessPath: process.env.VLESS_PATH || '/vless-ws',
  trojanPath: process.env.TROJAN_PATH || '/trojan-ws',
  publicHost: process.env.PUBLIC_HOST || '',
  sshPublicHost: process.env.SSH_PUBLIC_HOST || '',
  sshPublicPort: process.env.SSH_PUBLIC_PORT || '',
  adminPassword: process.env.ADMIN_PASS || '',
  cookieSecure: process.env.COOKIE_SECURE !== '0',
  behindProxy: process.env.TRUST_PROXY !== '0',
  signupPerIp: Number(process.env.SIGNUP_PER_IP || 2),
  signupDaily: Number(process.env.SIGNUP_DAILY || 40),
  signupMaxDays: Number(process.env.SIGNUP_MAX_DAYS || 7),
  dropbearLog: process.env.DROPBEAR_LOG || '/data/dropbear.log',
};

if (!CONFIG.adminPassword || CONFIG.adminPassword.length < 12) {
  console.error('[loket] ADMIN_PASS must be set and at least 12 characters');
  process.exit(1);
}

const sessions = new Sessions({ secret: process.env.SESSION_SECRET });
const loginThrottle = new Throttle({ limit: Number(process.env.LOGIN_LIMIT || 8), windowMs: 60_000 });
const signupThrottle = new Throttle({ limit: Number(process.env.SIGNUP_BURST || 5), windowMs: 10 * 60_000 });
const users = new Users({ dataDir: process.env.DATA_DIR || '/data' });
const usage = new Usage({ dataDir: process.env.DATA_DIR || '/data' });
const adminHash = hashPassword(CONFIG.adminPassword);
const nodesFilePath = process.env.NODES_FILE || path.join(process.env.DATA_DIR || '/data', 'nodes.json');

// One-shot seed: NODES_SEED=1 copies the bundled node list onto the volume.
// Remove the variable afterwards so rescans stay authoritative.
if (process.env.NODES_SEED === '1') {
  try {
    const bundled = fs.readFileSync(path.join(__dirname, '..', 'nodes.verified.json'), 'utf8');
    fs.writeFileSync(nodesFilePath, bundled);
    console.log(`[loket] nodes seeded from bundle -> ${nodesFilePath}`);
  } catch (err) {
    console.error(`[loket] node seed failed: ${err.message}`);
  }
}

let nodes = loadNodes();
let nodeById = new Map(nodes.map((n) => [n.id, n]));

function reloadNodes() {
  nodes = loadNodes();
  nodeById = new Map(nodes.map((n) => [n.id, n]));
}

const stats = { startedAt: Date.now(), rx: 0, tx: 0, sshRx: 0, sshTx: 0, activeSsh: 0, perIp: new Map() };

// ---------------------------------------------------------------- helpers

/**
 * Resolve the client address.
 *
 * Railway's edge appends the real client to X-Forwarded-For, so the *last*
 * entry is the one we can trust; anything the client sent sits to its left.
 * (Reading [0] — as before — recorded the internal 100.64.x.x hop and made IP
 * blocks useless.)
 */
function clientIp(req) {
  const chain = String(req.headers['x-forwarded-for'] || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (let i = chain.length - 1; i >= 0; i -= 1) {
    const candidate = chain[i].replace(/^\[|\]$/g, '').replace(/:\d+$/, '');
    if (net.isIP(candidate) && !isPrivateIp(candidate)) return candidate;
    if (net.isIP(candidate) && i === 0) return candidate; // all-internal chain
  }
  for (const header of ['cf-connecting-ip', 'x-real-ip', 'true-client-ip']) {
    const value = String(req.headers[header] || '').trim().replace(/:\d+$/, '');
    if (net.isIP(value) && !isPrivateIp(value)) return value;
  }
  if (process.env.LOG_IP_HEADERS === '1') {
    console.log('[loket] ip headers', JSON.stringify({
      xff: req.headers['x-forwarded-for'] || null,
      cf: req.headers['cf-connecting-ip'] || null,
      real: req.headers['x-real-ip'] || null,
      peer: req.socket.remoteAddress || null,
    }));
  }
  return (req.socket.remoteAddress || 'unknown').replace(/^::ffff:/, '');
}

function parseCookies(header = '') {
  const out = {};
  for (const part of String(header).split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function json(res, status, body, extraHeaders = {}) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...extraHeaders,
  });
  res.end(JSON.stringify(body));
}

function html(res, status, body) {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'content-security-policy':
      "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:;",
  });
  res.end(body);
}

function readBody(req, limit = 32 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const auth = (req) => {
  const cookies = parseCookies(req.headers.cookie);
  return { cookies, ok: sessions.verify(cookies.vx_session) };
};

function csrfOk(req, cookies) {
  const header = req.headers['x-csrf-token'];
  if (!header || !cookies.vx_csrf || String(header).length !== String(cookies.vx_csrf).length) return false;
  return crypto.timingSafeEqual(Buffer.from(String(header)), Buffer.from(String(cookies.vx_csrf)));
}

const randomName = () => `loket${crypto.randomBytes(3).toString('hex')}`;
const randomPassword = () => crypto.randomBytes(9).toString('base64url');

/** Everything a client needs, derived from one record. */
function buildConfig(record, password, nodeId = '') {
  const node = nodeId ? nodeById.get(nodeId) : null;
  const vlessPath = node ? `${CONFIG.vlessPath}-${node.id}` : CONFIG.vlessPath;
  const trojanPath = node ? `${CONFIG.trojanPath}-${node.id}` : CONFIG.trojanPath;
  const suffix = node ? `-${node.id}` : '';
  const host = CONFIG.publicHost || 'localhost';
  const sshHost = CONFIG.sshPublicHost || host;
  const sshPort = CONFIG.sshPublicPort || '22';
  const q = (s) => encodeURIComponent(s);
  return {
    username: record.username,
    password,
    uuid: record.uuid,
    trojanSecret: record.trojanSecret,
    expired: record.expired,
    sshCommand: `ssh ${record.username}@${sshHost} -p ${sshPort}`,
    sshWs: `host=${host} port=443 tls=on path=${CONFIG.sshPath} user=${record.username} pass=${password}`,
    node: node ? { id: node.id, name: node.name, flag: node.flag } : null,
    vless: `vless://${record.uuid}@${host}:443?encryption=none&security=tls&sni=${host}&type=ws&host=${host}&path=${q(vlessPath)}#loket-${record.username}${suffix}`,
    trojan: `trojan://${record.trojanSecret}@${host}:443?security=tls&sni=${host}&type=ws&host=${host}&path=${q(trojanPath)}#loket-${record.username}${suffix}`,
  };
}

// ---------------------------------------------------------------- server

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;
  const ip = clientIp(req);

  if (pathname === '/health') return json(res, 200, { ok: true, uptime: Math.floor((Date.now() - stats.startedAt) / 1000) });

  // ---- public proxy check endpoint ----
  if (pathname === '/api/check-proxy' && req.method === 'GET') {
    const pIp = url.searchParams.get('ip');
    const pPort = url.searchParams.get('port');
    if (!pIp || !pPort) return json(res, 400, { error: 'Missing params' });
    try {
      const result = await probeNode({ proxy: `http://${pIp}:${pPort}` });
      return json(res, 200, { 
        status: result.ok ? 'Active' : 'Offline', 
        ping_ms: result.ms 
      });
    } catch (e) {
      return json(res, 200, { status: 'Offline', error: e.message });
    }
  }

  // ---- public config endpoint (argo-node full parity) ----
  if (pathname === '/api/config' && req.method === 'GET') {
    const host = req.headers.host || CONFIG.publicHost || 'localhost';
    const nodeId = url.searchParams.get('node') || '';
    const bug = url.searchParams.get('bug') || '';
    const sec = url.searchParams.get('sec') || 'tls'; // 'tls' or 'none'
    const isTls = sec === 'tls';
    const port = isTls ? 443 : 80;
    
    const node = nodeId ? nodeById.get(nodeId) : null;
    const vlessPath = node ? `${CONFIG.vlessPath}-${node.id}` : CONFIG.vlessPath;
    const trojanPath = node ? `${CONFIG.trojanPath}-${node.id}` : CONFIG.trojanPath;
    const q = (s) => encodeURIComponent(s);
    
    // Fallback or demo UUID/Secret if not logged in
    const defaultUuid = 'c0a80101-0000-4000-8000-000000000001';
    const defaultSecret = 'loketsecret';
    const nodeTag = node ? `-${node.id.toUpperCase()}` : '-DIRECT';
    const connectHost = bug || host;

    // VMESS JSON Payload (CF CDN format)
    const vmessPayload = {
      v: '2',
      ps: `LOKET${nodeTag}-VMESS`,
      add: connectHost,
      port: port,
      id: defaultUuid,
      aid: '0',
      scy: 'auto',
      net: 'ws',
      type: 'none',
      host: host,
      path: vlessPath,
      tls: isTls ? 'tls' : '',
      sni: isTls ? (bug || host) : '',
      alpn: '',
      fp: 'firefox',
    };
    const vmessLink = `vmess://${Buffer.from(JSON.stringify(vmessPayload)).toString('base64')}`;

    const tlsParam = isTls ? `&security=tls&sni=${q(bug || host)}&fp=firefox` : '&security=none';

    return json(res, 200, {
      host,
      node: node ? { id: node.id, name: node.name, flag: node.flag } : null,
      native: {
        vless: `vless://${defaultUuid}@${connectHost}:${port}?encryption=none${tlsParam}&type=ws&host=${q(host)}&path=${q(vlessPath)}#LOKET${nodeTag}-VLESS`,
        trojan: `trojan://${defaultSecret}@${connectHost}:${port}?${tlsParam.slice(1)}&type=ws&host=${q(host)}&path=${q(trojanPath)}#LOKET${nodeTag}-TROJAN`,
      },
      argo: {
        vless: `vless://${defaultUuid}@${connectHost}:${port}?encryption=none${tlsParam}&type=ws&host=${q(host)}&path=${q(vlessPath)}#LOKET${nodeTag}-CDN-VLESS`,
        vmess: vmessLink,
        trojan: `trojan://${defaultSecret}@${connectHost}:${port}?${tlsParam.slice(1)}&type=ws&host=${q(host)}&path=${q(trojanPath)}#LOKET${nodeTag}-CDN-TROJAN`,
      },
    });
  }

  if (pathname === '/' && req.method === 'GET') {
    // Disabled IP blocking check on public dashboard
    return html(res, 200, publicPage({
      host: CONFIG.publicHost,
      sshHost: CONFIG.sshPublicHost || CONFIG.publicHost,
      sshPort: CONFIG.sshPublicPort || '22',
      limits: { perIp: CONFIG.signupPerIp },
      nodes: nodes.map((n) => ({ id: n.id, name: n.name, flag: n.flag })),
    }));
  }

  if (pathname === '/admin' && req.method === 'GET') return html(res, 200, adminPage({ host: CONFIG.publicHost }));

  // ---- public signup (no password, throttled per ip) ----
  if (pathname === '/api/public/signup' && req.method === 'POST') {
    const burst = signupThrottle.hit(ip);
    if (!burst.allowed) return json(res, 429, { error: 'terlalu sering, coba lagi nanti' });
    usage.resetDailyIfNeeded();
    const gate = usage.signupAllowed(ip, { perIp: CONFIG.signupPerIp, global: CONFIG.signupDaily });
    if (!gate.allowed) return json(res, 429, { error: gate.reason });

    let body = {};
    try {
      body = JSON.parse((await readBody(req)) || '{}');
    } catch {
      return json(res, 400, { error: 'bad request' });
    }

    const wanted = String(body.username || '').toLowerCase().trim();
    const username = wanted || randomName();
    const days = Math.min(Math.max(Number(body.days) || 1, 1), CONFIG.signupMaxDays);
    const password = randomPassword();

    try {
      const created = users.create({ username, password, days });
      usage.recordSignup({ username: created.username, ip });
      const cfg = buildConfig({ ...created, password }, password, String(body.node || '').toLowerCase().trim());
      const qr = { vless: await qrSvg(cfg.vless), trojan: await qrSvg(cfg.trojan) };
      return json(res, 201, { account: cfg, qr });
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
  }

  // ---- auth ----
  if (pathname === '/api/login' && req.method === 'POST') {
    const limit = loginThrottle.hit(ip);
    if (!limit.allowed) {
      return json(res, 429, { error: 'too many attempts' }, { 'retry-after': Math.ceil(limit.retryAfterMs / 1000) });
    }
    let password = '';
    try {
      password = JSON.parse((await readBody(req)) || '{}').password || '';
    } catch {
      return json(res, 400, { error: 'bad request' });
    }
    if (!verifyPassword(password, adminHash)) return json(res, 401, { error: 'wrong password' });
    loginThrottle.reset(ip);
    const csrf = crypto.randomBytes(18).toString('base64url');
    return json(res, 200, { ok: true, csrf }, {
      'set-cookie': [
        `vx_session=${sessions.issue()}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200${CONFIG.cookieSecure ? '; Secure' : ''}`,
        `vx_csrf=${csrf}; Path=/; SameSite=Strict; Max-Age=43200${CONFIG.cookieSecure ? '; Secure' : ''}`,
      ],
    });
  }

  if (pathname === '/api/logout' && req.method === 'POST') {
    const { cookies } = auth(req);
    sessions.revoke(cookies.vx_session);
    return json(res, 200, { ok: true }, { 'set-cookie': ['vx_session=; Path=/; Max-Age=0', 'vx_csrf=; Path=/; Max-Age=0'] });
  }

  // ---- everything below needs an admin session ----
  const { ok, cookies } = auth(req);
  if (!ok) return json(res, 401, { error: 'unauthorized' });
  if (!['GET', 'HEAD'].includes(req.method) && !csrfOk(req, cookies)) return json(res, 403, { error: 'bad csrf token' });

  if (pathname === '/api/me') return json(res, 200, { ok: true });

  if (pathname === '/api/stats') {
    return json(res, 200, {
      uptime: Math.floor((Date.now() - stats.startedAt) / 1000),
      activeSsh: stats.activeSsh,
      rx: stats.rx,
      tx: stats.tx,
      sshRx: stats.sshRx,
      sshTx: stats.sshTx,
      users: users.list().length,
    });
  }

  if (pathname === '/api/admin/overview') {
    const list = users.list().map((u) => {
      const rec = usage.userReport(u.username) || {};
      const bytes = (k) => (rec[k]?.bytesIn || 0) + (rec[k]?.bytesOut || 0);
      const sessionsOf = (k) => (rec[k]?.sessions || 0) + (rec[k]?.logins || 0);
      return {
        ...u,
        ip: rec.lastIp || null,
        lastSeen: rec.lastSeen || null,
        blocked: usage.isUserBlocked(u.username),
        bytes: { ssh: bytes('ssh'), vless: bytes('vless'), trojan: bytes('trojan') },
        sessions: { ssh: sessionsOf('ssh'), vless: sessionsOf('vless'), trojan: sessionsOf('trojan') },
      };
    });
    return json(res, 200, { users: list, ips: usage.ipReport(100) });
  }

  if (pathname === '/api/admin/nodes') {
    const report = await Promise.all(nodes.map(async (n) => ({ ...n, proxy: n.proxy ? 'set' : null, ...(await probeNode(n)) })));
    return json(res, 200, { nodes: report, file: nodesFilePath });
  }

  // Scan & filter proxies from raw text / uploaded file
  if (pathname === '/api/admin/scan' && req.method === 'POST') {
    try {
      const body = JSON.parse((await readBody(req, 2 * 1024 * 1024)) || '{}');
      const rawText = String(body.text || '');
      const save = Boolean(body.save);
      const concurrency = Math.min(Math.max(Number(body.concurrency) || 8, 1), 20);

      const candidates = parseRawProxies(rawText);
      if (!candidates.length) return json(res, 400, { error: 'tidak ada format proxy valid yang ditemukan' });

      const scanResult = await scanAndFilter(candidates, { concurrency });

      if (save && scanResult.nodes.length > 0) {
        fs.mkdirSync(path.dirname(nodesFilePath), { recursive: true });
        const cleanNodes = scanResult.nodes.map((n) => ({
          id: n.id,
          name: n.name,
          flag: n.flag,
          proxy: n.proxy,
        }));
        fs.writeFileSync(nodesFilePath, JSON.stringify(cleanNodes, null, 2) + '\n', { mode: 0o600 });
        reloadNodes();
      }

      return json(res, 200, {
        ok: true,
        total: scanResult.total,
        live: scanResult.live,
        saved: save,
        nodes: scanResult.nodes,
      });
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  }

  if (pathname === '/api/admin/block' && req.method === 'POST') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      if (body.type === 'ip') usage.blockIp(String(body.value), body.block !== false);
      else if (body.type === 'user') usage.blockUser(String(body.value), body.block !== false);
      else return json(res, 400, { error: 'type must be ip or user' });
      return json(res, 200, { ok: true });
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
  }

  if (pathname === '/api/users' && req.method === 'GET') return json(res, 200, { users: users.list() });

  if (pathname === '/api/users' && req.method === 'POST') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      return json(res, 201, { user: users.create(body) });
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
  }

  if (pathname === '/api/users/password' && req.method === 'POST') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      users.resetPassword(body.username, body.password);
      return json(res, 200, { ok: true });
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
  }

  if ((pathname === '/api/users' || pathname === '/api/admin/users') && req.method === 'DELETE') {
    try {
      return json(res, 200, { user: users.remove(url.searchParams.get('username')) });
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
  }

  return json(res, 404, { error: 'not found' });
});

function resolveRoute(pathname) {
  if (pathname === CONFIG.sshPath) return { kind: 'ssh', node: null };
  for (const base of ['vless', 'trojan']) {
    const basePath = base === 'vless' ? CONFIG.vlessPath : CONFIG.trojanPath;
    if (pathname === basePath) return { kind: base, node: null };
    const prefix = `${basePath}-`;
    if (pathname.startsWith(prefix)) {
      const node = nodeById.get(pathname.slice(prefix.length));
      if (node) return { kind: base, node };
    }
  }
  return null;
}

// ------------------------------------------------------------- websockets

const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });

server.on('upgrade', (req, socket, head) => {
  const ip = clientIp(req);
  if (usage.isIpBlocked(ip)) {
    socket.destroy();
    return;
  }
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const route = resolveRoute(pathname);
  if (!route) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    if (route.kind === 'ssh') {
      usage.recordAuth({ username: null, protocol: 'ssh', ip });
      attachSsh(ws, { req, targetHost: CONFIG.sshHost, targetPort: CONFIG.sshPort, stats });
    } else {
      const egress = route.node ? route.node.proxy : null;
      attachVless(ws, {
        kind: route.kind,
        users,
        stats,
        egress,
        isBlocked: (name) => usage.isUserBlocked(name),
        onAuth: ({ username }) => usage.recordAuth({ username, protocol: route.kind, ip }),
        onUsage: ({ username, bytesIn, bytesOut }) => usage.recordBytes({ username, protocol: route.kind, bytesIn, bytesOut }),
        connect: (opts) => openEgress({ proxyUrl: egress, host: opts.host, port: opts.port }),
      });
    }
  });
});

// SSH logins over the TCP proxy are only visible in dropbear's log.
tailDropbear({
  file: CONFIG.dropbearLog,
  onLogin: ({ username, ip }) => usage.recordAuth({ username, protocol: 'ssh', ip }),
});

// -------------------------------------------------------------- lifecycle

const sweeper = setInterval(() => {
  const removed = users.pruneExpired();
  if (removed.length) console.log(`[loket] pruned expired users: ${removed.join(', ')}`);
  usage.resetDailyIfNeeded();
  usage.flush();
  sessions.sweep();
}, 60 * 60 * 1000);

function shutdown(signal) {
  console.log(`[loket] ${signal} received, shutting down`);
  clearInterval(sweeper);
  usage.flush();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

server.on('error', (err) => {
  console.error(err.code === 'EADDRINUSE' ? `[loket] port ${CONFIG.port} already in use — set WEB_PORT` : `[loket] ${err.message}`);
  process.exit(1);
});

server.listen(CONFIG.port, '0.0.0.0', () => {
  console.log(`[loket] panel on :${CONFIG.port} (public generator + /admin)`);
  console.log(`[loket] ssh-ws ${CONFIG.sshPath} · vless ${CONFIG.vlessPath} · trojan ${CONFIG.trojanPath}`);
});
