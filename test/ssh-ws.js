'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const net = require('node:net');

process.env.SSH_WS_MAX_PER_IP = '1';
const { attachSsh } = require('../src/ssh-ws');

class FakeWebSocket extends EventEmitter {
  constructor() {
    super();
    this.OPEN = 1;
    this.readyState = this.OPEN;
    this.closeInfo = null;
  }

  send() {}

  close(code, reason) {
    if (this.readyState === 3) return;
    this.closeInfo = { code, reason };
    this.readyState = 3;
    this.emit('close');
  }
}

async function main() {
  const backend = net.createServer();
  await new Promise((resolve) => backend.listen(0, '127.0.0.1', resolve));
  const port = backend.address().port;
  const accepted = new Promise((resolve) => backend.once('connection', resolve));
  const ip = '192.0.2.10';
  const stats = { perIp: new Map(), activeSsh: 0, sshRx: 0, sshTx: 0 };
  const options = {
    ip,
    req: { headers: { 'x-forwarded-for': '203.0.113.10' }, socket: { remoteAddress: '127.0.0.1' } },
    targetHost: '127.0.0.1',
    targetPort: port,
    stats,
    log: { warn() {} },
  };

  const first = new FakeWebSocket();
  attachSsh(first, options);
  await accepted;
  assert.equal(stats.perIp.get(ip), 1, 'uses canonical IP passed by the server');
  assert.equal(stats.perIp.has('203.0.113.10'), false, 'ignores spoofed X-Forwarded-For');

  const rejected = new FakeWebSocket();
  attachSsh(rejected, options);
  assert.equal(rejected.closeInfo?.code, 1013, 'connection over per-IP cap is rejected');
  assert.equal(stats.perIp.get(ip), 1, 'rejected connection does not poison the counter');
  assert.equal(stats.activeSsh, 1);

  first.close();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(stats.perIp.has(ip), false, 'counter is released on close');
  assert.equal(stats.activeSsh, 0);
  await new Promise((resolve) => backend.close(resolve));
  console.log('ssh-ws: canonical IP and per-IP cap assertions passed');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
