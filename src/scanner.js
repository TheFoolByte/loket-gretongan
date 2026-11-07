/**
 * In-process proxy scanner & live probe engine.
 * Converts raw proxy lines or ProxyCheck reports into verified node entries.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { openEgress, parseProxy } = require('./upstream');
let parseProxyReport;
try {
  parseProxyReport = require('../scripts/import-nodes').parseProxyReport;
} catch {
  parseProxyReport = require('/app/scripts/import-nodes').parseProxyReport;
}

const GEO_HOST = 'ip-api.com';
const GEO_PATH = '/json?fields=status,message,country,countryCode,query';
const FALLBACK_HOST = 'example.com';

function httpGetJson(socket, host, path, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('timeout'));
    }, timeoutMs);
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

async function probeProxyUrl(proxyUrl, timeoutMs = 7000) {
  const started = Date.now();
  try {
    const socket = await openEgress({ proxyUrl, host: GEO_HOST, port: 80 });
    const geo = await httpGetJson(socket, GEO_HOST, GEO_PATH, timeoutMs);
    return {
      ok: true,
      ms: Date.now() - started,
      ip: geo.query || null,
      country: geo.country || null,
      cc: geo.countryCode ? geo.countryCode.toLowerCase() : null,
      note: geo.status === 'success' ? 'ok' : geo.message || 'geo not resolved',
    };
  } catch {
    try {
      const socket = await openEgress({ proxyUrl, host: FALLBACK_HOST, port: 80 });
      socket.destroy();
      return { ok: true, ms: Date.now() - started, ip: null, country: null, cc: null, note: 'tcp ok, no geo' };
    } catch (err) {
      return { ok: false, ms: Date.now() - started, ip: null, country: null, cc: null, note: err.code || err.message };
    }
  }
}

/**
 * Parse any raw input: either a ProxyCheck report block, or raw lines like:
 *   ip:port
 *   ip:port:user:pass
 *   http://user:pass@ip:port
 *   socks5://user:pass@ip:port
 */
function parseRawProxies(rawText) {
  const text = String(rawText || '').trim();
  if (!text) return [];

  // If report format detected
  if (text.includes('Proxy →') || text.includes('Status →')) {
    const { nodes } = parseProxyReport(text, { regions: ['*'], scheme: 'auto' });
    return nodes;
  }

  const nodes = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    let scheme = 'http';
    let host = '';
    let port = 0;
    let auth = '';

    if (trimmed.includes('://')) {
      try {
        const u = new URL(trimmed);
        scheme = u.protocol.replace(':', '');
        host = u.hostname;
        port = Number(u.port) || (scheme === 'socks5' ? 1080 : 80);
        if (u.username) auth = `${encodeURIComponent(u.username)}:${encodeURIComponent(u.password)}@`;
      } catch {
        continue;
      }
    } else {
      const parts = trimmed.split(/[:|]/);
      host = parts[0];
      port = Number(parts[1]);
      if (parts.length >= 4) {
        auth = `${encodeURIComponent(parts[2])}:${encodeURIComponent(parts[3])}@`;
      }
      scheme = [1080, 10808, 1081].includes(port) ? 'socks5' : 'http';
    }

    if (!host || !port || port < 1 || port > 65535) continue;

    nodes.push({
      id: '', // to be determined by geo cc
      name: '',
      flag: '',
      proxy: `${scheme}://${auth}${host}:${port}`,
    });
  }
  return nodes;
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

/**
 * Scan candidates: probes each, filters live ones, groups by country code (1 per cc).
 */
async function scanAndFilter(candidates, { concurrency = 8, timeoutMs = 7000 } = {}) {
  const probed = await mapLimit(candidates, concurrency, async (cand) => {
    const result = await probeProxyUrl(cand.proxy, timeoutMs);
    return { ...cand, result };
  });

  const verifiedNodes = [];
  const seenCc = new Set();

  for (const item of probed) {
    if (!item.result.ok) continue;
    const cc = (item.result.cc || item.id || '').toLowerCase();
    if (!cc || seenCc.has(cc)) continue;

    seenCc.add(cc);
    verifiedNodes.push({
      id: cc,
      name: item.result.country || item.name || cc.toUpperCase(),
      flag: cc.toUpperCase(),
      proxy: item.proxy,
      lat: item.result.ms,
      exitIp: item.result.ip,
    });
  }

  return { total: candidates.length, live: verifiedNodes.length, nodes: verifiedNodes, all: probed };
}

module.exports = {
  probeProxyUrl,
  parseRawProxies,
  scanAndFilter,
};
