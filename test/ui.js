'use strict';

const assert = require('node:assert/strict');
const vm = require('node:vm');
const { publicPage, dashboardPage, adminPage } = require('../src/ui');

const hostile = '<img src=x onerror=alert(1)>';
const generator = publicPage({
  host: 'loket-gretongan.coffeelens.web.id',
  wildcardDomain: 'loket-gretongan.coffeelens.web.id',
  vmessEnabled: true,
  nodes: [{
    id: 'sg',
    name: hostile,
    flag: 'SG',
    host: 'sg.loket-gretongan.coffeelens.web.id',
    proxy: 'socks5://user:pass@192.0.2.10:1080',
  }],
});
assert.ok(generator.includes('lang="id"'), 'pages declare Indonesian');
assert.ok(generator.includes('aria-expanded="false"'), 'menu exposes its state');
assert.ok(generator.includes('value="vmess">VMess</option>'), 'VMess is selectable when enabled');
assert.ok(generator.includes('value="sshWs">SSH-WS</option>'), 'SSH over WebSocket remains available');
assert.ok(generator.includes('/api/public/signup'), 'the UI creates real per-user accounts');
assert.ok(generator.includes('id="r-qr"'), 'a generated client profile can be imported by QR');
assert.ok(generator.includes('loket-gretongan.coffeelens.web.id'), 'wildcard service hostname is shown');
assert.ok(generator.includes('\\u003cimg src=x onerror=alert(1)>'), 'hostile node JSON cannot close the script element');
assert.ok(!generator.includes(hostile), 'untrusted node markup is not emitted as raw HTML');
assert.ok(!generator.includes('user:pass@192.0.2.10') && !generator.includes('192.0.2.10'), 'proxy credentials and addresses stay server-side');
assert.ok(!generator.includes('/api/config?'), 'UI does not use demo credentials');
assert.ok(!generator.includes('/api/check-proxy?'), 'UI does not invoke public port probes');
assert.ok(!generator.includes('masa aktif') && !generator.includes('id="f-days"'), 'generator has no validity-period selector');
const vmessDisabled = publicPage();
assert.ok(!vmessDisabled.includes('value="vmess"'), 'VMess is hidden when the backend is disabled');

const home = dashboardPage({ nodeCount: 7, vmessEnabled: true });
assert.ok(home.includes('>7</strong>'), 'dashboard reports configured node count');
assert.ok(home.includes('SSH-WS') && home.includes('VMess'), 'dashboard reports enabled gateway protocols');
assert.ok(home.includes('Wildcard hostname') && home.includes('WebSocket'), 'dashboard describes hostname and transport');

const admin = adminPage();
assert.ok(admin.includes('autocomplete="current-password"'), 'admin password field supports password managers');
assert.ok(admin.includes('aria-live="polite"'), 'admin status messages are announced');
assert.ok(admin.includes('Live bandwidth') && admin.includes('/api/stats'), 'admin dashboard monitors real traffic counters');
assert.ok(admin.includes('/api/admin/overview'), 'admin dashboard loads account/IP usage');
assert.ok(admin.includes('/api/admin/pull') && admin.includes('Pull &amp; Merge'), 'automatic proxy pull remains available');
assert.ok(admin.includes('/api/admin/scan'), 'manual node import remains available');

for (const [name, html] of [['generator', generator], ['dashboard', home], ['admin', admin]]) {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length, `${name} page includes its menu script`);
  for (const [index, match] of scripts.entries()) {
    assert.doesNotThrow(() => new vm.Script(match[1]), `${name} inline script ${index} parses`);
  }
}

console.log('ui: all assertions passed');
