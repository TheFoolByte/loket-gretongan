/**
 * Outbound destination guard.
 *
 * The proxy is reachable from the internet, so it must not become an SSRF
 * primitive into the container/host private network or cloud metadata endpoint.
 */
'use strict';

const dns = require('node:dns');
const net = require('node:net');

const BLOCKED_V4 = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

const BLOCKED_V6 = [
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
  ['::', 128],
];

function ipToBigInt(ip) {
  if (net.isIPv4(ip)) {
    return ip.split('.').reduce((acc, part) => (acc << 8n) + BigInt(Number(part)), 0n);
  }
  // Expand IPv6 (supports :: compression and embedded IPv4).
  let addr = ip;
  const v4 = addr.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const parts = v4[1].split('.').map(Number);
    const hi = ((parts[0] << 8) | parts[1]).toString(16);
    const lo = ((parts[2] << 8) | parts[3]).toString(16);
    addr = addr.replace(v4[1], `${hi}:${lo}`);
  }
  const [head, tail] = addr.split('::');
  const headParts = head ? head.split(':').filter(Boolean) : [];
  const tailParts = tail ? tail.split(':').filter(Boolean) : [];
  const missing = 8 - (headParts.length + tailParts.length);
  const groups = [...headParts, ...Array(addr.includes('::') ? missing : 0).fill('0'), ...tailParts];
  return groups.reduce((acc, group) => (acc << 16n) + BigInt(parseInt(group || '0', 16)), 0n);
}

function inRange(ip, base, prefix) {
  const bits = net.isIPv4(ip) ? 32 : 128;
  const shift = BigInt(bits - prefix);
  const mask = ((1n << BigInt(prefix)) - 1n) << shift;
  try {
    return (ipToBigInt(ip) & mask) === (ipToBigInt(base) & mask);
  } catch {
    return true; // unparseable → treat as unsafe
  }
}

function ipv4FromBigInt(value) {
  return [24n, 16n, 8n, 0n]
    .map((shift) => Number((value >> shift) & 255n))
    .join('.');
}

const IPV4_MAPPED_HIGH = ipToBigInt('::ffff:0:0') >> 32n;

function isPrivateIp(ip) {
  if (!ip) return true;
  if (net.isIPv4(ip)) {
    return BLOCKED_V4.some(([base, prefix]) => inRange(ip, base, prefix));
  }
  if (net.isIPv6(ip)) {
    const value = ipToBigInt(ip);
    const high = value >> 32n;
    if (high === 0n || high === IPV4_MAPPED_HIGH) {
      return isPrivateIp(ipv4FromBigInt(value & 0xffffffffn));
    }
    return BLOCKED_V6.some(([base, prefix]) => inRange(ip, base, prefix));
  }
  return true;
}

/**
 * Resolve a hostname to a single address and decide whether it is safe.
 * Returns { address, family } or throws when the target is not allowed.
 */
async function allowedTarget(host, { allowPrivate = process.env.ALLOW_PRIVATE_TARGETS === '1' } = {}) {
  if (!host || typeof host !== 'string') throw new Error('invalid host');
  if (host.length > 253) throw new Error('host too long');
  if (net.isIP(host)) {
    if (!allowPrivate && isPrivateIp(host)) throw new Error('target address is not allowed');
    return { address: host, family: net.isIPv4(host) ? 4 : 6 };
  }
  const { address, family } = await dns.promises.lookup(host, { verbatim: true });
  if (!allowPrivate && isPrivateIp(address)) throw new Error('target resolves to a private address');
  return { address, family };
}

module.exports = { allowedTarget, isPrivateIp };
