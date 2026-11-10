/**
 * Node registry: a named egress per country.
 *
 *   NODES=[{"id":"sg","name":"Singapore","flag":"🇸🇬","proxy":"socks5://user:pass@1.2.3.4:1080"}]
 *
 * Source order is persistent file, NODES environment, then bundled fallback;
 * explicit NODES=[] overrides all sources for direct-only operation.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { parseProxy } = require('./upstream');

const ID_RE = /^[a-z0-9-]{2,32}$/;

/**
 * Node sources (raw JSON arrays), first non-empty wins:
 *   1. file — $DATA_DIR/nodes.json (or NODES_FILE). Lives on the volume,
 *      survives deploys, suits long region lists.
 *   2. NODES env — quick start, one-line lists; an explicit [] disables all nodes.
 *   3. bundled nodes.verified.json — compatibility fallback for existing installs.
 */
function loadNodes(raw = process.env.NODES, file = process.env.NODES_FILE || path.join(process.env.DATA_DIR || '/data', 'nodes.json')) {
  let parsed = null;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(parsed) || parsed.length === 0) parsed = null;
  } catch {
    /* no persisted nodes file -> check the environment next */
  }
  if (typeof raw === 'string' && raw.trim() === '[]') parsed = [];
  if (parsed === null && typeof raw === 'string' && raw.trim()) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.error('[loket] NODES is not valid JSON — ignoring');
      return [];
    }
  }
  if (parsed === null) {
    try {
      const fallback = path.join(__dirname, '..', 'nodes.verified.json');
      parsed = JSON.parse(fs.readFileSync(fallback, 'utf8'));
      if (!Array.isArray(parsed) || parsed.length === 0) parsed = null;
    } catch {
      /* no bundled fallback available -> direct-only */
    }
  }
  if (parsed === null) return [];
  if (!Array.isArray(parsed)) {
    console.error('[loket] nodes must be a JSON array — ignoring');
    return [];
  }
  const nodes = [];
  for (const item of parsed.slice(0, 256)) {
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
      name: String(item.name || id).slice(0, 48),
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
