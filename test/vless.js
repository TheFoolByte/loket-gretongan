'use strict';

const assert = require('node:assert');
const net = require('node:net');
const { EventEmitter } = require('node:events');

// Test-only: the destination is the local echo server, not a public target.
process.env.ALLOW_PRIVATE_TARGETS = '1';
const { attachVless } = require('../src/vless');

class TestSocket extends EventEmitter {
  constructor() {
    super();
    this.OPEN = 1;
    this.readyState = 1;
    this.sent = [];
  }
  send(data) { this.sent.push(Buffer.from(data)); }
  close() { this.readyState = 3; this.emit('close'); }
}

(async () => {
  const echo = net.createServer((socket) => socket.on('data', (data) => socket.write(data)));
  await new Promise((resolve) => echo.listen(0, '127.0.0.1', resolve));
  const ws = new TestSocket();
  const counters = { rx: 0, tx: 0 };
  try {
    // The socket has completed `connect` before attachVless receives it, just
    // like an authenticated multi-region egress through an upstream proxy.
    attachVless(ws, {
      kind: 'vless',
      users: { findByUuid: () => ({ username: 'test' }) },
      stats: counters,
      connect: () => new Promise((resolve) => {
        const socket = net.createConnection({ host: '127.0.0.1', port: echo.address().port }, () => resolve(socket));
      }),
    });
    const header = Buffer.concat([
      Buffer.from([0]), Buffer.alloc(16), Buffer.from([0, 1]),
      Buffer.from([echo.address().port >> 8, echo.address().port & 255]),
      Buffer.from([1, 127, 0, 0, 1]), Buffer.from('ping'),
    ]);
    ws.emit('message', header);
    // Only the VLESS response header goes to the client; the upstream gets
    // rawClientData, so the echo server returns the payload without that header.
    const expected = Buffer.from([0, 0, ...Buffer.from('ping')]);
    for (let i = 0; i < 100 && Buffer.concat(ws.sent).length < expected.length; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(Buffer.concat(ws.sent).toString('hex'), expected.toString('hex'), `relay frames: ${ws.sent.map((data) => data.toString('hex')).join(',')}`);
    assert.ok(counters.vlessRx >= header.length, 'VLESS client-to-service bytes are counted by protocol');
    assert.ok(counters.vlessTx >= Buffer.byteLength('ping'), 'VLESS service-to-client bytes are counted by protocol');
    console.log('upstream relay startup: all assertions passed');
  } finally {
    ws.close();
    echo.close();
  }
})().catch((err) => { console.error(err); process.exitCode = 1; });
