'use strict';

/**
 * Pull fresh proxy lists from public sources.
 * Each source is a raw text file of `host:port` or `user:pass@host:port` lines.
 * We tag every candidate with its source + scheme and let the scanner probe it.
 */

const SOURCES = [
  {
    name: 'hideip.me',
    scheme: 'http',
    url: 'https://github.com/zloi-user/hideip.me/raw/refs/heads/main/http.txt',
  },
  {
    name: 'hideip.me',
    scheme: 'https',
    url: 'https://github.com/zloi-user/hideip.me/raw/refs/heads/main/https.txt',
  },
  {
    name: 'hideip.me',
    scheme: 'socks5',
    url: 'https://github.com/zloi-user/hideip.me/raw/refs/heads/main/socks5.txt',
  },
  {
    name: 'sunny9577',
    scheme: 'http',
    url: 'https://sunny9577.github.io/proxy-scraper/generated/http_proxies.txt',
  },
  {
    name: 'sunny9577',
    scheme: 'socks5',
    url: 'https://sunny9577.github.io/proxy-scraper/generated/socks5_proxies.txt',
  },
];

function parseLine(line, scheme, source) {
  const trimmed = String(line || '').trim();
  if (!trimmed || trimmed.startsWith('#')) return null;

  let host = '';
  let port = 0;
  let auth = '';
  let hintCountry = null;

  if (trimmed.includes('://')) {
    try {
      const u = new URL(trimmed);
      host = u.hostname;
      port = Number(u.port) || (u.protocol === 'socks5:' ? 1080 : 80);
      if (u.username) auth = `${u.username}:${u.password}@`;
    } catch {
      return null;
    }
  } else {
    const at = trimmed.lastIndexOf('@');
    const hostPort = at >= 0 ? trimmed.slice(at + 1) : trimmed;
    if (at >= 0) auth = `${trimmed.slice(0, at)}@`;

    // Accept `host:port` or `host:port:CountryLabel` (hideip.me format).
    const parts = hostPort.split(':');
    host = parts[0] || '';
    port = Number(parts[1]);
    if (parts.length > 2) hintCountry = parts.slice(2).join(':').trim() || null;
  }

  if (!host || !port || !Number.isFinite(port) || port < 1 || port > 65535) return null;
  if (host === 'localhost' || host.startsWith('127.') || host.startsWith('0.0.0.0')) return null;

  return {
    source,
    scheme,
    proxy: `${scheme}://${auth}${host}:${port}`,
    host,
    port,
    hintCountry,
  };
}

async function fetchSource(source, timeoutMs = 30000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(source.url, { redirect: 'follow', signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    return text.split(/\r?\n/).map((l) => parseLine(l, source.scheme, source.name)).filter(Boolean);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch all sources and return deduplicated candidates.
 * Returns { candidates, bySource }.
 */
async function fetchSources() {
  const bySource = {};
  const seen = new Set();
  const candidates = [];

  for (const source of SOURCES) {
    try {
      const list = await fetchSource(source);
      bySource[source.name] = (bySource[source.name] || 0) + list.length;
      for (const c of list) {
        if (seen.has(c.proxy)) continue;
        seen.add(c.proxy);
        candidates.push(c);
      }
    } catch (err) {
      console.error(`[sources] ${source.name} ${source.scheme} failed:`, err.message);
      bySource[source.name] = (bySource[source.name] || 0);
    }
  }

  return { candidates, bySource };
}

module.exports = { SOURCES, fetchSources };
