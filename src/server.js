/**
 * LOKET — portable single-container gateway for managed platforms or VPS.
 *
 *   /                     public landing page
 *   /vpn                  public account generator (rate limited, no password)
 *   /admin                admin monitor (ADMIN_PASS, session + csrf)
 *   /health               liveness
 *   /api/public/signup    create an account, return ready-to-paste configs
 *   /api/admin/*          users + ip monitoring, block/unblock
 *   /ssh-ws /vless-ws /trojan-ws /vmess-ws   websocket gateways
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
const { publicPage, dashboardPage, adminPage, qrSvg } = require('./ui');
const { loadNodes, probeNode } = require('./nodes');
const { openEgress } = require('./upstream');
const { parseRawProxies, scanAndFilter } = require('./scanner');
const { pullFreshProxies } = require('./pull');
const { XrayVmessManager, buildVmessUri } = require('./xray-vmess');
const { attachVmess } = require('./vmess-ws');
const { SessionLimiter, installIdleTimeout } = require('./session-limits');
const { normalizeDomain, normalizePublicHost, hostForNode, matchWildcardHost } = require('./wildcard');

const CONFIG = {
  port: Number(process.env.WEB_PORT || process.env.PORT || 8080),
  sshPort: Number(process.env.SSH_PORT || 22),
  sshHost: process.env.SSH_HOST || '127.0.0.1',
  sshPath: process.env.SSH_WS_PATH || '/ssh-ws',
  vlessPath: process.env.VLESS_PATH || '/vless-ws',
  trojanPath: process.env.TROJAN_PATH || '/trojan-ws',
  vmessPath: process.env.VMESS_PATH || '/vmess-ws',
  vmessInternalPath: process.env.VMESS_INTERNAL_PATH || '/vmess',
  wildcardDomain: normalizeDomain(process.env.WILDCARD_DOMAIN || ''),
  publicHost: normalizePublicHost(process.env.PUBLIC_HOST || ''),
  vmessEnabled: process.env.VMESS_ENABLED === '1',
  sshPublicHost: process.env.SSH_PUBLIC_HOST || '',
  sshPublicPort: process.env.SSH_PUBLIC_PORT || '',
  adminPassword: process.env.ADMIN_PASS || '',
  cookieSecure: process.env.COOKIE_SECURE !== '0',
  behindProxy: process.env.TRUST_PROXY !== '0',
  signupPerIp: Number(process.env.SIGNUP_PER_IP || 2),
  signupDaily: Number(process.env.SIGNUP_DAILY || 40),
  signupMaxDays: Number(process.env.SIGNUP_MAX_DAYS || 7),
  wsMaxConnections: process.env.WS_MAX_CONNECTIONS,
  wsMaxPerIp: process.env.WS_MAX_PER_IP,
  wsMaxPerUser: process.env.WS_MAX_PER_USER,
  wsIdleTimeoutMs: process.env.WS_IDLE_TIMEOUT_MS,
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

let nodes = loadNodes();
let nodeById = new Map(nodes.map((n) => [n.id, n]));

const vmessManager = new XrayVmessManager({
  enabled: CONFIG.vmessEnabled,
  apiPort: Number(process.env.VMESS_API_PORT || 10085),
  portBase: Number(process.env.VMESS_PORT_BASE || 15000),
  wsPath: CONFIG.vmessInternalPath,
  onFatal: (err) => {
    console.error(`[loket] Xray fatal: ${err.message}`);
    if (server.listening) process.exit(1);
  },
});

function activeVmessUsers() {
  return users.list().filter((u) => u.active && !usage.isUserBlocked(u.username));
}

function syncVmess(options = {}) {
  return vmessManager.sync(activeVmessUsers(), nodes, options);
}

async function reloadNodes() {
  nodes = loadNodes();
  nodeById = new Map(nodes.map((n) => [n.id, n]));
  if (CONFIG.vmessEnabled) await syncVmess({ forceRestart: true });
}

/**
 * Pull fresh proxies, merge into the current node list (dedupe by proxy URL),
 * cap at MAX_NODES, persist and hot-reload.
 */
async function performPull({ limit, concurrency, maxLatencyMs } = {}) {
  const result = await pullFreshProxies({ limit, concurrency, maxLatencyMs });

  const existing = nodes.map((n) => ({ ...n }));
  const seen = new Set(existing.map((n) => n.proxy));
  const merged = [...existing];
  let added = 0;
  for (const n of result.nodes) {
    if (seen.has(n.proxy)) continue;
    seen.add(n.proxy);
    merged.push(n);
    added += 1;
  }

  const cap = Math.max(1, Number(process.env.MAX_NODES || 500));
  const final = merged.slice(0, cap);

  fs.mkdirSync(path.dirname(nodesFilePath), { recursive: true });
  fs.writeFileSync(nodesFilePath, JSON.stringify(final, null, 2) + '\n', { mode: 0o600 });
  await reloadNodes();

  return { fetched: result.total, live: result.live, added, total: final.length, bySource: result.bySource };
}

const stats = {
  startedAt: Date.now(), rx: 0, tx: 0, vlessRx: 0, vlessTx: 0, trojanRx: 0, trojanTx: 0,
  sshRx: 0, sshTx: 0, vmessRx: 0, vmessTx: 0, activeSsh: 0, activeWs: 0, perIp: new Map(),
};
const sessionLimiter = new SessionLimiter({
  maxGlobal: CONFIG.wsMaxConnections,
  maxPerIp: CONFIG.wsMaxPerIp,
  maxPerUser: CONFIG.wsMaxPerUser,
});

// ---------------------------------------------------------------- helpers

/**
 * Resolve the client address.
 *
 * Behind a trusted reverse proxy, use the final public address appended to the
 * forwarded chain. On direct VPS ingress, TRUST_PROXY=0 ignores all forwarded
 * headers so clients cannot spoof IP-based limits or blocklists.
 */
function clientIp(req) {
  if (!CONFIG.behindProxy) {
    return (req.socket.remoteAddress || 'unknown').replace(/^::ffff:/, '');
  }
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
  const baseHost = hostForNode('', CONFIG.wildcardDomain, CONFIG.publicHost);
  const host = hostForNode(node?.id || '', CONFIG.wildcardDomain, CONFIG.publicHost);
  const nodeHost = Boolean(node && CONFIG.wildcardDomain && host !== baseHost);
  const suffix = node && !nodeHost ? `-${node.id}` : '';
  const vlessPath = `${CONFIG.vlessPath}${suffix}`;
  const trojanPath = `${CONFIG.trojanPath}${suffix}`;
  const vmessPath = `${CONFIG.vmessPath}${suffix}`;
  const sshHost = CONFIG.sshPublicHost || baseHost;
  const sshPort = CONFIG.sshPublicPort || '22';
  const q = (s) => encodeURIComponent(s);
  const result = {
    username: record.username,
    password,
    uuid: record.uuid,
    trojanSecret: record.trojanSecret,
    expired: record.expired,
    sshCommand: CONFIG.sshPublicHost && CONFIG.sshPublicPort ? `ssh ${record.username}@${sshHost} -p ${sshPort}` : null,
    sshWs: `host=${baseHost} port=443 tls=on path=${CONFIG.sshPath} user=${record.username} pass=${password}`,
    node: node ? { id: node.id, name: node.name, flag: node.flag } : null,
    vless: `vless://${record.uuid}@${host}:443?encryption=none&security=tls&sni=${host}&type=ws&host=${host}&path=${q(vlessPath)}#loket-${record.username}${suffix}`,
    trojan: `trojan://${record.trojanSecret}@${host}:443?security=tls&sni=${host}&type=ws&host=${host}&path=${q(trojanPath)}#loket-${record.username}${suffix}`,
  };
  if (CONFIG.vmessEnabled) {
    result.vmess = buildVmessUri({ uuid: record.uuid, username: record.username, host, path: vmessPath, label: node?.name || 'direct' });
  }
  return result;
}

// ---------------------------------------------------------------- server

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;
  const ip = clientIp(req);

  const adminPath = pathname === '/admin' || pathname === '/api/login' || pathname === '/api/logout' || pathname === '/api/me' || pathname.startsWith('/api/admin/');
  if (usage.isIpBlocked(ip) && pathname !== '/health' && pathname !== '/api/public/signup' && !adminPath) {
    return json(res, 403, { error: 'ip blocked' });
  }

  if (pathname === '/health') return json(res, 200, { ok: true, uptime: Math.floor((Date.now() - stats.startedAt) / 1000) });

  // Demo credentials are deliberately not generated; clients use real accounts.
  if (pathname === '/api/config' && req.method === 'GET') {
    return json(res, 410, { error: 'Konfigurasi demo dihentikan. Buat akun melalui /vpn agar kredensialnya valid.' });
  }

  if (pathname === '/' && req.method === 'GET') {
    return html(res, 200, dashboardPage({ nodeCount: nodes.length, vmessEnabled: CONFIG.vmessEnabled }));
  }

  if (pathname === '/vpn' && req.method === 'GET') {
    return html(res, 200, publicPage({
      host: hostForNode('', CONFIG.wildcardDomain, CONFIG.publicHost),
      wildcardDomain: CONFIG.wildcardDomain,
      vmessEnabled: CONFIG.vmessEnabled,
      limits: { perIp: CONFIG.signupPerIp, maxDays: CONFIG.signupMaxDays },
      nodes: nodes.map((n) => ({
        id: n.id,
        name: n.name,
        flag: n.flag,
        cc: n.cc || n.flag,
        host: hostForNode(n.id, CONFIG.wildcardDomain, CONFIG.publicHost),
      })),
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

    const nodeId = String(body.node || '').toLowerCase().trim();
    if (nodeId && !nodeById.has(nodeId)) return json(res, 400, { error: 'node tidak tersedia' });
    const wanted = String(body.username || '').toLowerCase().trim();
    const username = wanted || randomName();
    const requestedDays = Number(body.days);
    const days = Number.isInteger(requestedDays) && requestedDays > 0
      ? Math.min(requestedDays, CONFIG.signupMaxDays)
      : CONFIG.signupMaxDays;
    const password = randomPassword();

    let created = null;
    try {
      created = users.create({ username, password, days });
      await syncVmess();
      usage.recordSignup({ username: created.username, ip });
      const cfg = buildConfig({ ...created, password }, password, nodeId);
      const qr = { vless: await qrSvg(cfg.vless), trojan: await qrSvg(cfg.trojan) };
      if (cfg.vmess) qr.vmess = await qrSvg(cfg.vmess);
      return json(res, 201, { account: cfg, qr });
    } catch (err) {
      if (created && CONFIG.vmessEnabled) {
        try { users.remove(created.username); await syncVmess(); } catch { /* keep public error generic */ }
        console.error(`[loket] VMess account sync failed for ${created.username}`);
        return json(res, 503, { error: 'Layanan VMess sedang tidak siap; akun belum dibuat. Coba lagi nanti.' });
      }
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
      activeWs: stats.activeWs,
      rx: stats.rx,
      tx: stats.tx,
      vlessRx: stats.vlessRx,
      vlessTx: stats.vlessTx,
      trojanRx: stats.trojanRx,
      trojanTx: stats.trojanTx,
      sshRx: stats.sshRx,
      sshTx: stats.sshTx,
      vmessRx: stats.vmessRx,
      vmessTx: stats.vmessTx,
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
        bytes: { ssh: bytes('ssh'), vless: bytes('vless'), trojan: bytes('trojan'), vmess: bytes('vmess') },
        sessions: { ssh: sessionsOf('ssh'), vless: sessionsOf('vless'), trojan: sessionsOf('trojan'), vmess: sessionsOf('vmess') },
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
      const rawText = String(body.text || body.raw || '');
      const save = Boolean(body.save === true || body.autoSave === true);
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
        await reloadNodes();
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

  if (pathname === '/api/admin/pull' && req.method === 'POST') {
    try {
      const body = JSON.parse((await readBody(req, 64 * 1024)) || '{}');
      const limit = Math.min(Math.max(Number(body.limit) || 400, 50), 2000);
      const concurrency = Math.min(Math.max(Number(body.concurrency) || 24, 1), 50);
      const summary = await performPull({ limit, concurrency, maxLatencyMs: Number(body.maxLatencyMs) || 5000 });
      return json(res, 200, { ok: true, ...summary });
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  }

  if (pathname === '/api/admin/block' && req.method === 'POST') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      if (body.type === 'ip') usage.blockIp(String(body.value), body.block !== false);
      else if (body.type === 'user') {
        usage.blockUser(String(body.value), body.block !== false);
        await syncVmess();
      }
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
      const user = users.create(body);
      try { await syncVmess(); } catch {
        users.remove(user.username);
        await syncVmess().catch(() => {});
        return json(res, 503, { error: 'Xray VMess belum siap; akun tidak dibuat.' });
      }
      return json(res, 201, { user });
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
      const removed = users.remove(url.searchParams.get('username'));
      await syncVmess();
      return json(res, 200, { user: removed });
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
  }

  return json(res, 404, { error: 'not found' });
});

function resolveRoute(pathname, hostHeader = '') {
  const hostRoute = matchWildcardHost(hostHeader, CONFIG.wildcardDomain, nodeById);
  if (hostRoute.invalid) return null;
  if (pathname === CONFIG.sshPath) return { kind: 'ssh', node: null };

  let route = null;
  const paths = [
    ['vless', CONFIG.vlessPath],
    ['trojan', CONFIG.trojanPath],
    ...(CONFIG.vmessEnabled ? [['vmess', CONFIG.vmessPath]] : []),
  ];
  for (const [kind, basePath] of paths) {
    if (pathname === basePath) { route = { kind, node: null }; break; }
    const prefix = `${basePath}-`;
    if (pathname.startsWith(prefix)) {
      const node = nodeById.get(pathname.slice(prefix.length));
      if (node) { route = { kind, node }; break; }
    }
  }
  if (!route) return null;
  if (hostRoute.matched && hostRoute.node) {
    if (route.node && route.node.id !== hostRoute.node.id) return null;
    route.node = hostRoute.node;
  }
  return route;
}

// ------------------------------------------------------------- websockets

const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });

server.on('upgrade', (req, socket, head) => {
  const ip = clientIp(req);
  if (usage.isIpBlocked(ip)) {
    socket.destroy();
    return;
  }
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const route = resolveRoute(pathname, req.headers.host || '');
  if (!route) {
    socket.destroy();
    return;
  }
  const reservation = sessionLimiter.reserve(ip);
  if (!reservation.ok) {
    const status = reservation.reason === 'ip' ? '429 Too Many Requests' : '503 Service Unavailable';
    socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nRetry-After: 10\r\nContent-Length: 0\r\n\r\n`);
    return;
  }
  let counted = false;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    reservation.release();
    if (counted) {
      counted = false;
      stats.activeWs = Math.max(0, stats.activeWs - 1);
    }
  };
  socket.once('close', release);
  wss.handleUpgrade(req, socket, head, (ws) => {
    stats.activeWs += 1;
    counted = true;
    ws.once('close', release);
    ws.once('error', release);
    const onActivity = installIdleTimeout(ws, CONFIG.wsIdleTimeoutMs);
    if (route.kind === 'ssh') {
      usage.recordAuth({ username: null, protocol: 'ssh', ip });
      attachSsh(ws, { ip, targetHost: CONFIG.sshHost, targetPort: CONFIG.sshPort, stats, onActivity });
    } else if (route.kind === 'vmess') {
      attachVmess(ws, { port: vmessManager.portFor(route.node?.id), path: CONFIG.vmessInternalPath, stats, onActivity });
    } else {
      const egress = route.node ? route.node.proxy : null;
      attachVless(ws, {
        kind: route.kind,
        users,
        stats,
        egress,
        onActivity,
        isBlocked: (name) => usage.isUserBlocked(name),
        onAuth: ({ username }) => {
          if (!reservation.attachUser(username)) return false;
          usage.recordAuth({ username, protocol: route.kind, ip });
          return true;
        },
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
  if (removed.length) {
    console.log(`[loket] pruned expired users: ${removed.join(', ')}`);
    syncVmess().catch((err) => { console.error(`[loket] VMess expiry sync failed: ${err.message}`); process.exit(1); });
  }
  usage.resetDailyIfNeeded();
  usage.flush();
  sessions.sweep();
}, 60 * 60 * 1000);

// Optional auto-refresh of the public proxy pool (set AUTO_PULL_MINUTES > 0).
const autoPullMinutes = Math.max(0, Number(process.env.AUTO_PULL_MINUTES || 0));
if (autoPullMinutes > 0) {
  const run = async () => {
    try {
      const s = await performPull({ limit: Number(process.env.AUTO_PULL_LIMIT || 300), concurrency: 24 });
      console.log(`[loket] auto-pull: fetched ${s.fetched}, live ${s.live}, added ${s.added}, total ${s.total}`);
    } catch (err) {
      console.error('[loket] auto-pull failed:', err.message);
    }
  };
  setInterval(run, autoPullMinutes * 60_000).unref?.();
  console.log(`[loket] auto-pull every ${autoPullMinutes} min`);
}

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[loket] ${signal} received, shutting down`);
  clearInterval(sweeper);
  usage.flush();
  await vmessManager.stop().catch(() => {});
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

server.on('error', (err) => {
  console.error(err.code === 'EADDRINUSE' ? `[loket] port ${CONFIG.port} already in use — set PORT or WEB_PORT` : `[loket] ${err.message}`);
  process.exit(1);
});

async function start() {
  try {
    if (CONFIG.vmessEnabled) await vmessManager.start(activeVmessUsers(), nodes);
    server.listen(CONFIG.port, '0.0.0.0', () => {
      console.log(`[loket] panel on :${CONFIG.port} (public generator + /admin)`);
      console.log(`[loket] ssh-ws ${CONFIG.sshPath} · vless ${CONFIG.vlessPath} · trojan ${CONFIG.trojanPath}${CONFIG.vmessEnabled ? ` · vmess ${CONFIG.vmessPath}` : ''}`);
    });
  } catch (err) {
    console.error(`[loket] startup failed: ${err.message}`);
    await vmessManager.stop().catch(() => {});
    process.exit(1);
  }
}

start();
