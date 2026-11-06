/**
 * Smoke test — runs the real HTTP server with the privileged helper disabled.
 *   node test/smoke.js
 */
'use strict';

const assert = require('node:assert');
const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');

const PORT = 18080;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_PASS = 'test-password-123';

const child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
  env: {
    ...process.env,
    PORT: String(PORT),
    ADMIN_PASS,
    DATA_DIR: '/tmp/loket-smoke',
    LOKET_NO_HELPER: '1',
    COOKIE_SECURE: '0',
    LOGIN_LIMIT: '3',
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
    await call('POST', '/api/login', { password: 'x1' });
    await call('POST', '/api/login', { password: 'x2' });
    await call('POST', '/api/login', { password: 'x3' });
    const limited = await call('POST', '/api/login', { password: 'x4' });
    assert.equal(limited.status, 429, 'login throttled');

    // websocket paths must exist but never upgrade without auth headers they need
    const wsProbe = await new Promise((resolve) => {
      const req = http.request({ host: '127.0.0.1', port: PORT, path: '/does-not-exist', headers: { connection: 'Upgrade', upgrade: 'websocket' } });
      req.on('response', (res) => resolve(res.statusCode));
      req.on('upgrade', () => resolve(101));
      req.on('error', () => resolve('error'));
      req.end();
    });
    assert.notEqual(wsProbe, 101, 'unknown ws path is not upgraded');

    console.log('\nsmoke: all assertions passed');
    process.exitCode = 0;
  } catch (err) {
    console.error('\nsmoke FAILED:', err.message);
    process.exitCode = 1;
  } finally {
    child.kill('SIGTERM');
    setTimeout(() => child.kill('SIGKILL'), 1500).unref();
  }
})();
