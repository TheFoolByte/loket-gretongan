'use strict';

const assert = require('node:assert/strict');
const { isPrivateIp } = require('../src/net-guard');

for (const ip of [
  '::ffff:127.0.0.1',
  '0:0:0:0:0:ffff:7f00:1',
  '::ffff:7f00:1',
  '::7f00:1',
  '::ffff:10.1.2.3',
  '0:0:0:0:0:ffff:a00:203',
]) {
  assert.equal(isPrivateIp(ip), true, `${ip} must be treated as private`);
}

for (const ip of [
  '::ffff:8.8.8.8',
  '0:0:0:0:0:ffff:808:808',
  '2001:4860:4860::8888',
]) {
  assert.equal(isPrivateIp(ip), false, `${ip} must remain usable`);
}

console.log('net-guard: IPv4-mapped IPv6 assertions passed');
