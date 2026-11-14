'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { SessionLimiter, installIdleTimeout } = require('../src/session-limits');

class FakeWebSocket extends EventEmitter {
  constructor() {
    super();
    this.OPEN = 1;
    this.readyState = this.OPEN;
    this.closeInfo = null;
  }

  close(code, reason) {
    if (this.readyState !== this.OPEN) return;
    this.closeInfo = { code, reason };
    this.readyState = 3;
    this.emit('close');
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const limiter = new SessionLimiter({ maxGlobal: 2, maxPerIp: 1, maxPerUser: 1 });
  const first = limiter.reserve('192.0.2.1');
  assert.equal(first.ok, true);
  assert.equal(limiter.reserve('192.0.2.1').reason, 'ip');
  const second = limiter.reserve('192.0.2.2');
  assert.equal(second.ok, true);
  assert.equal(limiter.reserve('192.0.2.3').reason, 'global');
  assert.equal(first.attachUser('alice'), true);
  assert.equal(second.attachUser('ALICE'), false, 'per-user cap is case-insensitive');
  first.release();
  assert.equal(second.attachUser('alice'), true, 'released user slot can be reused');
  second.release();
  second.release();
  assert.equal(limiter.active, 0);
  assert.equal(limiter.perIp.size, 0);
  assert.equal(limiter.perUser.size, 0);

  const ws = new FakeWebSocket();
  installIdleTimeout(ws, 60);
  await wait(35);
  ws.emit('message', Buffer.from('activity'));
  await wait(35);
  assert.equal(ws.closeInfo, null, 'activity resets idle timer');
  await wait(40);
  assert.equal(ws.closeInfo?.code, 1001, 'idle connection is closed');
  console.log('session-limits: all assertions passed');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
