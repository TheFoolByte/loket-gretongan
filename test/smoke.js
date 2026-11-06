/**
 * Smoke test — runs the real HTTP server with the privileged helper disabled.
 *   node test/smoke.js
 */
'use strict';

const assert = require('node:assert');
const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const PORT = 18080;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_PASS = 'test-password-123';

const child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
  env: {
    ...process.env,
    PORT: String(PORT),
    ADMIN_PASS,
    DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'loket-smoke-')),
    LOKET_NO_HELPER: '1',
    COOKIE_SECURE: '0',
    LOGIN_LIMIT: '10',
    SIGNUP_PER_IP: '2',
    SIGNUP_BURST: '3',
    SSH_PUBLIC_HOST: 'ssh.example.test',
    SSH_PUBLIC_PORT: '4444',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

child.stdout.on('data', (d) => process.stdout.write(`[srv] ${d}`));
child.stderr.on('data', (d) => process.stderr.write(`[srv] ${d}`));

const jar = new Map();

function remember(res) {
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const cookie of raw) {
    const [pair] = cookie.split(';');
    const idx = pair.indexOf('=');
    jar.set(pair.slice(0, idx), pair.slice(idx + 1));
  }
}

const cookieHeader = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');

async function call(method, pathname, body, headers = {}) {
  const res = await fetch(BASE + pathname, {
    method,
    headers: {
      'content-type': 'application/json',
      cookie: cookieHeader(),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  remember(res);
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

async function waitReady() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return;
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('server did not become ready');
}

(async () => {
  try {
    await waitReady();

    const health = await call('GET', '/health');
    assert.equal(health.status, 200, 'health is public');
    assert.equal(health.data.ok, true);

    const noAuth = await call('GET', '/api/users');
    assert.equal(noAuth.status, 401, 'users require a session');

    const wrong = await call('POST', '/api/login', { password: 'nope' });
    assert.equal(wrong.status, 401, 'wrong password rejected');

    const login = await call('POST', '/api/login', { password: ADMIN_PASS });
    assert.equal(login.status, 200, 'login succeeds');
    assert.ok(jar.get('vx_session'), 'session cookie issued');
    assert.ok(jar.get('vx_csrf'), 'csrf cookie issued');
    assert.equal(login.data.csrf, jar.get('vx_csrf'), 'csrf echoed');

    const me = await call('GET', '/api/me');
    assert.equal(me.status, 200, 'session accepted');

    const noCsrf = await call('POST', '/api/users', { username: 'alice', password: 'long-password-1' }, { 'x-csrf-token': '' });
    assert.equal(noCsrf.status, 403, 'csrf required');

    const created = await call(
      'POST',
      '/api/users',
      { username: 'alice', password: 'long-password-1', days: 7 },
      { 'x-csrf-token': jar.get('vx_csrf') },
    );
    assert.equal(created.status, 201, `create user: ${JSON.stringify(created.data)}`);
    assert.ok(created.data.user.trojanSecret, 'trojan secret returned once');

    const list = await call('GET', '/api/users');
    assert.equal(list.status, 200);
    assert.equal(list.data.users.length, 1);
    assert.equal(list.data.users[0].password, undefined, 'password never listed');

    const dup = await call(
      'POST',
      '/api/users',
      { username: 'alice', password: 'long-password-2' },
      { 'x-csrf-token': jar.get('vx_csrf') },
    );
    assert.equal(dup.status, 400, 'duplicate rejected');

    const bad = await call(
      'POST',
      '/api/users',
      { username: 'Root;rm -rf /', password: 'long-password-3' },
      { 'x-csrf-token': jar.get('vx_csrf') },
    );
    assert.equal(bad.status, 400, 'hostile username rejected');

    const del = await call('DELETE', '/api/users?username=alice', null, { 'x-csrf-token': jar.get('vx_csrf') });
    assert.equal(del.status, 200, `delete: ${JSON.stringify(del.data)}`);

    const logout = await call('POST', '/api/logout', null, { 'x-csrf-token': jar.get('vx_csrf') });
    assert.equal(logout.status, 200);
    jar.clear();

    const afterLogout = await call('GET', '/api/users');
    assert.equal(afterLogout.status, 401, 'session revoked');

    // throttle: 4th wrong attempt inside the window must be 429

    // ---- public generator ----
    const pub1 = await call('POST', '/api/public/signup', { days: 2 });
    assert.equal(pub1.status, 201, `signup 1: ${JSON.stringify(pub1.data)}`);
    assert.ok(pub1.data.account.vless.startsWith('vless://'), 'vless uri');
    assert.ok(pub1.data.account.trojan.startsWith('trojan://'), 'trojan uri');
    assert.ok(pub1.data.account.sshCommand.includes('-p 4444'), 'ssh command uses public port');
    assert.ok(pub1.data.qr.vless.includes('<svg'), 'qr svg rendered');

    const pub2 = await call('POST', '/api/public/signup', {});
    assert.equal(pub2.status, 201, `signup2: ${JSON.stringify(pub2.data)}`);

    const pub3 = await call('POST', '/api/public/signup', {});
    assert.equal(pub3.status, 429, 'third signup throttled');

    // ---- admin monitoring ----
    const relog = await call('POST', '/api/login', { password: ADMIN_PASS });
    assert.equal(relog.status, 200, `relogin: ${JSON.stringify(relog.data)}`);
    const csrf = jar.get('vx_csrf');

    const overview = await call('GET', '/api/admin/overview');
    assert.equal(overview.status, 200);
    assert.ok(overview.data.users.length >= 2, 'admin sees created users');
    const withIp = overview.data.users.find((u) => u.ip);
    assert.ok(withIp, 'signup ip recorded');
    assert.ok(overview.data.ips.length >= 1, 'ip report populated');

    // block the ip, then a fresh signup must be refused
    const block = await call('POST', '/api/admin/block', { type: 'ip', value: withIp.ip, block: true }, { 'x-csrf-token': csrf });
    assert.equal(block.status, 200, 'block ip');
    const blockedSignup = await call('POST', '/api/public/signup', {});
    assert.equal(blockedSignup.status, 429, 'blocked ip cannot sign up');
    await call('POST', '/api/admin/block', { type: 'ip', value: withIp.ip, block: false }, { 'x-csrf-token': csrf });

    // ---- client ip resolution: right-most xff entry wins, spoofed prefix ignored ----
    const relog2 = await call('POST', '/api/login', { password: ADMIN_PASS });
    assert.equal(relog2.status, 200, 'admin login for ip test');
    const csrf2 = jar.get('vx_csrf');
    await call('POST', '/api/admin/block', { type: 'ip', value: '198.51.100.7', block: true }, { 'x-csrf-token': csrf2 });
    const blockedHome = await call('GET', '/', null, { 'x-forwarded-for': '203.0.113.99, 198.51.100.7' });
    assert.equal(blockedHome.status, 403, 'right-most xff ip is enforced');
    const spoofHome = await call('GET', '/', null, { 'x-forwarded-for': '198.51.100.7, 203.0.113.99' });
    assert.equal(spoofHome.status, 200, 'client-supplied left entry cannot fake the ip');
    await call('POST', '/api/admin/block', { type: 'ip', value: '198.51.100.7', block: false }, { 'x-csrf-token': csrf2 });

    // websocket paths must exist but never upgrade without auth headers they need
    const wsProbe = await new Promise((resolve) => {
      const req = http.request({ host: '127.0.0.1', port: PORT, path: '/does-not-exist', headers: { connection: 'Upgrade', upgrade: 'websocket' } });
      req.on('response', (res) => resolve(res.statusCode));
      req.on('upgrade', () => resolve(101));
      req.on('error', () => resolve('error'));
      req.end();
    });
    assert.notEqual(wsProbe, 101, 'unknown ws path is not upgraded');

    let limited = null;
    for (let i = 0; i < 14 && !limited; i += 1) {
      const attempt = await call('POST', '/api/login', { password: `wrong-${i}` });
      if (attempt.status === 429) limited = attempt;
    }
    assert.ok(limited, 'login throttled after repeated failures');

    console.log('\nsmoke: all assertions passed');
    process.exitCode = 0;
  } catch (err) {
    console.error('\nsmoke FAILED:', err.message); if (process.env.SMOKE_DEBUG) console.error(err.stack);
    process.exitCode = 1;
  } finally {
    child.kill('SIGTERM');
    setTimeout(() => child.kill('SIGKILL'), 1500).unref();
  }
})();
