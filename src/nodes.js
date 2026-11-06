/**
 * Node registry: a named egress per country.
 *
 *   NODES=[{"id":"sg","name":"Singapore","flag":"🇸🇬","proxy":"socks5://user:pass@1.2.3.4:1080"}]
 *
 * Only proxies the operator owns or rents belong here. No credentials are
 * shipped with the image; an empty list means "direct only".
 */
'use strict';

const net = require('node:net');
const { parseProxy } = require('./upstream');

const ID_RE = /^[a-z0-9-]{2,16}$/;

function loadNodes(raw = process.env.NODES) {
  if (!raw || !raw.trim()) return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error('[loket] NODES is not valid JSON — ignoring');
    return [];
  }
  if (!Array.isArray(parsed)) {
    console.error('[loket] NODES must be a JSON array — ignoring');
    return [];
  }
  const nodes = [];
  for (const item of parsed.slice(0, 12)) {
    const id = String(item?.id || '').toLowerCase().trim();
    if (!ID_RE.test(id)) {
      console.error(`[loket] node skipped (bad id): ${JSON.stringify(item?.id)}`);
      continue;
    }
    if (nodes.some((n) => n.id === id)) {
      console.error(`[loket] node skipped (duplicate id): ${id}`);
      continue;
    }
    let proxy = null;
    if (item.proxy) {
      try {
        parseProxy(item.proxy);
        proxy = String(item.proxy);
      } catch (err) {
        console.error(`[loket] node ${id} skipped: ${err.message}`);
        continue;
      }
    }
    nodes.push({
      id,
      name: String(item.name || id).slice(0, 32),
      flag: String(item.flag || '').slice(0, 8),
      proxy,
    });
  }
  return nodes;
}

/** Quick TCP health probe against the proxy endpoint (no auth needed). */
async function probeNode(node, timeoutMs = 5000) {
  if (!node.proxy) return { ok: true, ms: 0, note: 'direct' };
  const proxy = parseProxy(node.proxy);
  const started = Date.now();
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: proxy.host, port: proxy.port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve({ ok: false, ms: Date.now() - started, note: 'timeout' });
    }, timeoutMs);
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.destroy();
      resolve({ ok: true, ms: Date.now() - started, note: 'tcp ok' });
    });
    socket.once('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, ms: Date.now() - started, note: err.code || err.message });
    });
  });
}

module.exports = { loadNodes, probeNode };
