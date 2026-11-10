'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const WebSocket = require('ws');
const { WebSocketServer } = require('ws');
const { XrayVmessManager, buildXrayConfig, buildVmessUri } = require('../src/xray-vmess');
const { attachVmess } = require('../src/vmess-ws');
const { normalizeDomain, hostForNode, matchWildcardHost } = require('../src/wildcard');

async function bridgeTest() {
  const counters = {};
  const backend = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(backend, 'listening');
  backend.on('connection', (ws, req) => {
    assert.equal(req.url, '/vmess');
    ws.on('message', (data, isBinary) => ws.send(data, { binary: isBinary }));
  });

  const front = http.createServer();
  const frontWss = new WebSocketServer({ noServer: true });
  front.on('upgrade', (req, socket, head) => {
    frontWss.handleUpgrade(req, socket, head, (ws) => attachVmess(ws, { port: backend.address().port, path: '/vmess', stats: counters }));
  });
  front.listen(0, '127.0.0.1');
  await once(front, 'listening');

  const client = new WebSocket(`ws://127.0.0.1:${front.address().port}/vmess-ws`);
  const response = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('bridge timed out')), 4000);
    client.once('open', () => client.send(Buffer.from('vmess-bridge-test')));
    client.once('message', (data) => { clearTimeout(timer); resolve(data.toString()); });
    client.once('error', (err) => { clearTimeout(timer); reject(err); });
  });
  assert.equal(await response, 'vmess-bridge-test', 'frames reach the selected Xray WebSocket inbound and return');
  assert.ok(counters.vmessRx >= Buffer.byteLength('vmess-bridge-test'), 'VMess client-to-service payload is counted');
  assert.ok(counters.vmessTx >= Buffer.byteLength('vmess-bridge-test'), 'VMess service-to-client payload is counted');
  client.close();
  await once(client, 'close');
  await new Promise((resolve) => front.close(resolve));
  await new Promise((resolve) => backend.close(resolve));
}

(async () => {
  const users = [
    { username: 'alice', uuid: '00000000-0000-4000-8000-000000000001', active: true },
    { username: 'expired', uuid: '00000000-0000-4000-8000-000000000002', active: false },
  ];
  const nodes = [
    { id: 'sg', proxy: 'socks5://operator:secret@192.0.2.10:1080' },
    { id: 'direct', proxy: null },
  ];
  const built = buildXrayConfig({ users, nodes, portBase: 15000, apiPort: 10085, wsPath: '/vmess' });
  assert.equal(built.config.inbounds.length, 2, 'direct + proxied node inbound');
  assert.deepEqual(built.config.inbounds[0].settings.clients.map((c) => c.email), ['alice@loket.invalid'], 'inactive users are excluded');
  assert.equal(built.nodePorts.sg, 15001, 'node gets its own loopback inbound');
  assert.equal(built.nodePorts.direct, 15000, 'direct-only node reuses direct inbound');
  const nodeOutbound = built.config.outbounds.find((o) => o.tag === 'node-egress-1');
  assert.equal(nodeOutbound.protocol, 'socks');
  assert.equal(nodeOutbound.settings.servers[0].users[0].pass, 'secret');
  assert.ok(built.config.routing.rules.some((r) => r.network === 'udp' && r.outboundTag === 'block'), 'UDP is fail-closed');
  assert.ok(built.config.routing.rules[0].ip.includes('geoip:private'), 'private destinations are blocked before egress');
  assert.equal(built.config.routing.rules.find((r) => r.inboundTag?.[0] === 'vmess-node-1').outboundTag, 'node-egress-1');

  const uri = buildVmessUri({ uuid: users[0].uuid, username: 'alice', host: 'sg.loket.example', path: '/vmess-ws' });
  const decoded = JSON.parse(Buffer.from(uri.slice('vmess://'.length), 'base64').toString('utf8'));
  assert.equal(decoded.id, users[0].uuid);
  assert.equal(decoded.add, 'sg.loket.example');
  assert.equal(decoded.net, 'ws');
  assert.equal(decoded.path, '/vmess-ws');
  assert.equal(decoded.tls, 'tls');

  const domain = normalizeDomain('*.loket.example');
  const byId = new Map(nodes.map((n) => [n.id, n]));
  assert.equal(hostForNode('sg', domain, 'public.example'), 'sg.loket.example');
  assert.equal(matchWildcardHost('sg.loket.example:443', domain, byId).node.id, 'sg');
  assert.equal(matchWildcardHost('loket.example', domain, byId).matched, true);
  assert.equal(matchWildcardHost('unknown.loket.example', domain, byId).invalid, true);
  assert.equal(matchWildcardHost('www.example.net', domain, byId).matched, false);
  assert.throws(() => normalizeDomain('https://example.com/path'));

  const disabled = new XrayVmessManager({ enabled: false });
  await disabled.start([], []);
  assert.equal(disabled.portFor('sg'), 15000, 'disabled manager remains inert');

  await bridgeTest();
  console.log('vmess: all assertions passed');
})().catch((err) => {
  console.error('vmess FAILED:', err);
  process.exitCode = 1;
});
