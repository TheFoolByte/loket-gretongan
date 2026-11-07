#!/usr/bin/env node
/**
 * Live probe for a node list: runs a real handshake through every proxy
 * (SOCKS5 auth or HTTP CONNECT) and, when possible, fetches the exit IP +
 * country through the tunnel so the region can be verified.
 *
 *   node scripts/probe-nodes.js [nodes.json] [--concurrency 10] [--timeout 8000]
 *
 * No proxy list is modified or contacted for anything but this read-only check.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { openEgress } = require('../src/upstream');
const { loadNodes } = require('../src/nodes');

const GEO_HOST = 'ip-api.com';
const GEO_PATH = '/json?fields=status,message,countryCode,country,city,query';
const FALLBACK_HOST = '1.1.1.1';

function httpGetJson(socket, host, path, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('geo read timeout')); }, timeoutMs);
    let buf = Buffer.alloc(0);
    socket.on('data', (chunk) => { buf = Buffer.concat([buf, chunk]); });
    socket.on('error', (err) => { clearTimeout(timer); reject(err); });
    socket.on('close', () => {
      clearTimeout(timer);
      const sep = buf.indexOf('\r\n\r\n');
      const body = sep >= 0 ? buf.subarray(sep + 4).toString('utf8') : '';
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('bad geo response'));
      }
    });
    socket.write(`GET ${path} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\nUser-Agent: loket-probe\r\n\r\n`);
  });
}

async function probeNode(node, { timeoutMs }) {
  const started = Date.now();
  try {
    const socket = await openEgress({ proxyUrl: node.proxy, host: GEO_HOST, port: 80 });
    const geo = await httpGetJson(socket, GEO_HOST, GEO_PATH, timeoutMs);
    return { ok: true, ms: Date.now() - started, ip: geo.query || null, cc: geo.countryCode || null, note: geo.status === 'success' ? null : geo.message || 'geo not resolved' };
  } catch {
    try {
      const socket = await openEgress({ proxyUrl: node.proxy, host: FALLBACK_HOST, port: 80 });
      socket.destroy();
      return { ok: true, ms: Date.now() - started, ip: null, cc: null, note: 'tcp ok, no geo' };
    } catch (err) {
      return { ok: false, ms: Date.now() - started, ip: null, cc: null, note: err.code || err.message };
    }
  }
}

function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index], index);
    }
  }
  return Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker)).then(() => results);
}

function pad(value, width) {
  return String(value ?? '').padEnd(width).slice(0, width);
}

function usage() {
  return 'Usage: node scripts/probe-nodes.js [nodes.json] [--concurrency 10] [--timeout 8000] [--write verified.json]';
}

function parseArgs(argv) {
  const opts = { concurrency: 10, timeoutMs: 8000, file: null, write: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--concurrency') opts.concurrency = Number(argv[++i]);
    else if (arg === '--timeout') opts.timeoutMs = Number(argv[++i]);
    else if (arg === '--write') opts.write = argv[++i];
    else if (arg.startsWith('--')) throw new Error(`unknown option ${arg}`);
    else opts.file = arg;
  }
  return opts;
}

async function main(argv) {
  const { file, concurrency, timeoutMs, write } = parseArgs(argv);
  let nodes = file ? loadNodes('[]', file) : loadNodes();
  if (!nodes.length && !file) {
    const example = path.join(__dirname, '..', 'nodes.example.json');
    if (fs.existsSync(example)) nodes = loadNodes('[]', example);
  }
  if (!nodes.length) throw new Error('no nodes found — pass a file or set NODES');

  console.log(`probing ${nodes.length} node(s) — concurrency ${concurrency}, timeout ${timeoutMs}ms\n`);
  const results = await mapLimit(nodes, concurrency, (node) => probeNode(node, { timeoutMs }));

  console.log(`${pad('node', 5)} ${pad('flag', 4)} ${pad('latency', 8)} ${pad('exit ip', 16)} ${pad('geo', 4)} ${pad('status', 12)} note`);
  const failed = [];
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    const res = results[i];
    const geo = res.cc ? res.cc : '-';
    const ip = res.ip ? res.ip : '-';
    const latency = res.ok ? `${res.ms} ms` : '-';
    const status = res.ok ? 'ok' : 'FAIL';
    const mismatch = res.ok && res.cc && node.flag && res.cc !== node.flag ? `  <-- expected ${node.flag}` : '';
    console.log(`${pad(node.id, 5)} ${pad(node.flag, 4)} ${pad(latency, 8)} ${pad(ip, 16)} ${pad(geo, 4)} ${pad(status, 12)} ${res.note || ''}${mismatch}`);
    if (!res.ok) failed.push(node.id);
    if (res.ok && res.cc && node.flag && res.cc !== node.flag) failed.push(`${node.id}(geo=${res.cc}≠${node.flag})`);
  }
  const okCount = nodes.length - results.filter((res) => !res.ok).length;
  console.log(`\n${okCount}/${nodes.length} reachable${failed.length ? ` · masalah: ${failed.join(', ')}` : ''}`);

  if (write) {
    // Keep only reachable nodes whose exit country matches (or is unknown);
    // a mismatched exit means the source report mislabelled the region.
    const keep = nodes.filter((node, i) => {
      const res = results[i];
      return res.ok && (!res.cc || res.cc === node.flag);
    });
    fs.writeFileSync(write, `${JSON.stringify(keep, null, 2)}\n`, { mode: 0o600 });
    console.log(`wrote ${keep.length} verified node(s) to ${write}`);
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err.message || usage());
    process.exitCode = 1;
  });
}

module.exports = { probeNode };
