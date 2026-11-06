/**
 * LOKET HARDENED — single-service gateway for Railway.
 *
 * Routes:
 *   GET  /                dashboard (login form when unauthenticated)
 *   POST /api/login       password -> session cookie + csrf token
 *   POST /api/logout
 *   GET  /api/me          session probe
 *   GET  /api/users       list (auth)
 *   POST /api/users       create (auth + csrf)
 *   POST /api/users/password  reset a user's password (auth + csrf)
 *   DELETE /api/users     delete (auth + csrf)
 *   GET  /api/stats       counters (auth)
 *   GET  /health          liveness (no auth, no secrets)
 *
 * WebSocket upgrades: SSH_WS_PATH -> dropbear, VLESS_PATH / TROJAN_PATH -> relay
 * with per-user credentials.
 */
'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const { WebSocketServer } = require('ws');

const { Sessions, Throttle, hashPassword, verifyPassword } = require('./auth');
const { Users } = require('./users');
const { attachSsh } = require('./ssh-ws');
const { attachVless } = require('./vless');

const CONFIG = {
  port: Number(process.env.PORT || 8080),
  sshPort: Number(process.env.SSH_PORT || 22),
  sshHost: process.env.SSH_HOST || '127.0.0.1',
  sshPath: process.env.SSH_WS_PATH || '/ssh-ws',
  vlessPath: process.env.VLESS_PATH || '/vless-ws',
  trojanPath: process.env.TROJAN_PATH || '/trojan-ws',
  publicHost: process.env.PUBLIC_HOST || '',
  adminPassword: process.env.ADMIN_PASS || '',
  cookieSecure: process.env.COOKIE_SECURE !== '0',
  behindProxy: process.env.TRUST_PROXY !== '0',
};

if (!CONFIG.adminPassword || CONFIG.adminPassword.length < 12) {
  console.error('[loket] ADMIN_PASS must be set and at least 12 characters');
  process.exit(1);
}

const sessions = new Sessions({ secret: process.env.SESSION_SECRET });
const loginThrottle = new Throttle({ limit: Number(process.env.LOGIN_LIMIT || 8), windowMs: 60_000 });
const users = new Users({ dataDir: process.env.DATA_DIR || '/data' });
const adminHash = hashPassword(CONFIG.adminPassword);

const stats = {
  startedAt: Date.now(),
  rx: 0,
  tx: 0,
  sshRx: 0,
  sshTx: 0,
  activeSsh: 0,
  perIp: new Map(),
};

// ---------------------------------------------------------------- helpers

function clientIp(req) {
  if (CONFIG.behindProxy) {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (forwarded) return forwarded;
  }
  return req.socket.remoteAddress || 'unknown';
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
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...extraHeaders,
  });
  res.end(payload);
}

function html(res, status, body) {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'content-security-policy':
      "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'self'",
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

function auth(req) {
  const cookies = parseCookies(req.headers.cookie);
  return { ok: sessions.verify(cookies.vx_session), cookies };
}

function csrfOk(req, cookies) {
  const header = req.headers['x-csrf-token'];
  const cookie = cookies.vx_csrf;
  if (!header || !cookie || header.length !== cookie.length) return false;
  return crypto.timingSafeEqual(Buffer.from(String(header)), Buffer.from(String(cookie)));
}

// ---------------------------------------------------------------- dashboard

function page({ loggedIn }) {
  const csrf = loggedIn ? 'csrf-from-cookie' : '';
  return `<!doctype html>
<html lang="id"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>LOKET · gateway</title>
<style>
  :root{color-scheme:dark}
  body{margin:0;font:14px/1.5 ui-sans-serif,system-ui,sans-serif;background:#0b0f14;color:#d7e0ea}
  main{max-width:860px;margin:0 auto;padding:24px}
  h1{font-size:18px;margin:0 0 4px}
  .muted{color:#7c8b9d}
  .card{border:1px solid #1e2836;background:#111823;border-radius:10px;padding:16px;margin:14px 0}
  input,button{font:inherit;padding:9px 11px;border-radius:8px;border:1px solid #263241;background:#0e141c;color:#d7e0ea}
  button{background:#1b6ef3;border-color:#1b6ef3;cursor:pointer}
  button.ghost{background:transparent;border-color:#263241}
  button.danger{background:#7f1d1d;border-color:#7f1d1d}
  table{width:100%;border-collapse:collapse}
  th,td{text-align:left;padding:8px 6px;border-bottom:1px solid #1a2431;font-size:13px}
  code{background:#0e141c;padding:2px 6px;border-radius:6px;font-size:12px}
  .row{display:flex;gap:8px;flex-wrap:wrap}
  .err{color:#fca5a5}
</style></head>
<body><main>
  <h1>LOKET <span class="muted">hardened</span></h1>
  <p class="muted">SSH-WS · VLESS-WS · Trojan-WS · satu container</p>
  <div id="app"></div>
</main>
<script>
const CSRF = ${JSON.stringify(csrf)};
const loggedIn = ${loggedIn ? 'true' : 'false'};
const app = document.getElementById('app');

async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', 'x-csrf-token': CSRF, ...(opts.headers || {}) },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function loginView() {
  app.innerHTML = \`<div class="card">
    <form id="f"><div class="row">
      <input id="p" type="password" placeholder="ADMIN_PASS" autocomplete="current-password" style="flex:1">
      <button>Masuk</button>
    </div><p id="e" class="err"></p></form></div>\`;
  document.getElementById('f').onsubmit = async (ev) => {
    ev.preventDefault();
    try {
      await api('/api/login', { method: 'POST', body: JSON.stringify({ password: document.getElementById('p').value }) });
      location.reload();
    } catch (err) { document.getElementById('e').textContent = err.message; }
  };
}

async function dashView() {
  const [{ users }, st] = await Promise.all([api('/api/users'), api('/api/stats')]);
  app.innerHTML = \`
  <div class="card">
    <div class="row" style="justify-content:space-between;align-items:center">
      <b>SSH users</b><button class="ghost" id="out">Keluar</button>
    </div>
    <table><thead><tr><th>user</th><th>expired</th><th>VLESS uuid</th><th></th></tr></thead>
    <tbody>\${users.map(u => \`<tr><td>\${u.username}</td><td>\${u.expired}</td>
      <td><code>\${u.uuid.slice(0, 8)}…</code></td>
      <td><button class="danger" data-del="\${u.username}">hapus</button></td></tr>\`).join('')}
    </tbody></table>
    <p class="muted">\${st.activeSsh} koneksi SSH aktif · rx \${st.rx}B / tx \${st.txB}</p>
  </div>
  <div class="card">
    <b>Buat user</b>
    <div class="row" style="margin-top:10px">
      <input id="u" placeholder="username" style="flex:1">
      <input id="pw" placeholder="password (min 10)" style="flex:1">
      <input id="d" placeholder="hari" value="30" style="width:90px">
      <button id="add">Tambah</button>
    </div>
    <p id="msg" class="muted"></p>
  </div>\`;
  document.getElementById('out').onclick = async () => { await api('/api/logout', { method: 'POST' }); location.reload(); };
  document.getElementById('add').onclick = async () => {
    const msg = document.getElementById('msg');
    try {
      const r = await api('/api/users', { method: 'POST', body: JSON.stringify({
        username: document.getElementById('u').value,
        password: document.getElementById('pw').value,
        days: Number(document.getElementById('d').value || 30),
      }) });
      msg.innerHTML = \`dibuat: <code>\${r.user.username}</code> · Trojan secret: <code>\${r.user.trojanSecret}</code> (simpan, hanya tampil sekali)\`;
      setTimeout(dashView, 1500);
    } catch (err) { msg.innerHTML = '<span class="err">' + err.message + '</span>'; }
  };
  app.querySelectorAll('[data-del]').forEach((btn) => {
    btn.onclick = async () => {
      if (!confirm('Hapus ' + btn.dataset.del + '?')) return;
      try { await api('/api/users?username=' + encodeURIComponent(btn.dataset.del), { method: 'DELETE' }); dashView(); }
      catch (err) { alert(err.message); }
    };
  });
}

if (loggedIn) dashView().catch((err) => { app.innerHTML = '<p class="err">' + err.message + '</p>'; });
else loginView();
</script></body></html>`;
}

// ---------------------------------------------------------------- http

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;

  if (path === '/health') return json(res, 200, { ok: true, uptime: Math.floor((Date.now() - stats.startedAt) / 1000) });

  if (path === '/' && req.method === 'GET') {
    const { ok } = auth(req);
    return html(res, 200, page({ loggedIn: ok }));
  }

  if (path === '/api/login' && req.method === 'POST') {
    const ip = clientIp(req);
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
    const cookie = [
      `vx_session=${sessions.issue()}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200${CONFIG.cookieSecure ? '; Secure' : ''}`,
      `vx_csrf=${csrf}; Path=/; SameSite=Strict; Max-Age=43200${CONFIG.cookieSecure ? '; Secure' : ''}`,
    ];
    return json(res, 200, { ok: true, csrf }, { 'set-cookie': cookie });
  }

  if (path === '/api/logout' && req.method === 'POST') {
    const { cookies } = auth(req);
    sessions.revoke(cookies.vx_session);
    return json(res, 200, { ok: true }, {
      'set-cookie': ['vx_session=; Path=/; Max-Age=0', 'vx_csrf=; Path=/; Max-Age=0'],
    });
  }

  // Everything below requires a session.
  const { ok, cookies } = auth(req);
  if (!ok) return json(res, 401, { error: 'unauthorized' });

  if (path.startsWith('/api/') && !['GET', 'HEAD'].includes(req.method) && !csrfOk(req, cookies)) {
    return json(res, 403, { error: 'bad csrf token' });
  }

  if (path === '/api/me') return json(res, 200, { ok: true });

  if (path === '/api/stats') {
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

  if (path === '/api/users' && req.method === 'GET') {
    return json(res, 200, { users: users.list() });
  }

  if (path === '/api/users' && req.method === 'POST') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      const created = users.create(body);
      return json(res, 201, { user: created });
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
  }

  if (path === '/api/users/password' && req.method === 'POST') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      users.resetPassword(body.username, body.password);
      return json(res, 200, { ok: true });
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
  }

  if (path === '/api/users' && req.method === 'DELETE') {
    try {
      return json(res, 200, { user: users.remove(url.searchParams.get('username')) });
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
  }

  return json(res, 404, { error: 'not found' });
});

// ---------------------------------------------------------------- websockets

const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });

server.on('upgrade', (req, socket, head) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  const kind = path === CONFIG.sshPath ? 'ssh' : path === CONFIG.vlessPath ? 'vless' : path === CONFIG.trojanPath ? 'trojan' : null;
  if (!kind) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    if (kind === 'ssh') {
      attachSsh(ws, { req, targetHost: CONFIG.sshHost, targetPort: CONFIG.sshPort, stats });
    } else {
      attachVless(ws, { kind, users, stats });
    }
  });
});

// ---------------------------------------------------------------- lifecycle

const sweeper = setInterval(() => {
  const removed = users.pruneExpired();
  if (removed.length) console.log(`[loket] pruned expired users: ${removed.join(', ')}`);
  sessions.sweep();
}, 60 * 60 * 1000);

function shutdown(signal) {
  console.log(`[loket] ${signal} received, shutting down`);
  clearInterval(sweeper);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

server.listen(CONFIG.port, '0.0.0.0', () => {
  console.log(`[loket] dashboard on :${CONFIG.port}`);
  console.log(`[loket] ssh-ws ${CONFIG.sshPath} -> ${CONFIG.sshHost}:${CONFIG.sshPort}`);
  console.log(`[loket] vless ${CONFIG.vlessPath} · trojan ${CONFIG.trojanPath} (auth required)`);
});
