'use strict';

/**
 * Pull fresh public proxies, verify each really forwards traffic, and enrich
 * the survivors with offline ASN/city data. Returns ready-to-save node entries.
 */

const { openEgress } = require('./upstream');
const { fetchSources } = require('./sources');
const { enrichBulk } = require('./geo');

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

/** Real check: open an egress socket THROUGH the proxy; success = proxy forwards. */
async function checkProxy(proxyUrl, timeoutMs = 8000) {
  const started = Date.now();
  try {
    const socket = await openEgress({ proxyUrl, host: 'example.com', port: 80, timeoutMs });
    socket.destroy();
    return { ok: true, ms: Date.now() - started };
  } catch (err) {
    return { ok: false, ms: Date.now() - started, note: err.code || err.message };
  }
}

function slug(s) {
  return String(s || 'generic').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'generic';
}

function normalizeOrg(org) {
  return String(org || '')
    .replace(/\s+/g, ' ')
    .replace(/(,\s*)?(LLC|Inc\.?|Ltd\.?|Corp\.?|Limited|Corporation|B\.V\.?|S\.A\.?|JSC|Co\.?)$/i, '')
    .replace(/\.+$/, '')
    .trim();
}

/**
 * @param {object} opts
 * @param {number} [opts.concurrency]  parallel probe workers
 * @param {number} [opts.timeoutMs]    per-proxy probe timeout
 * @param {number} [opts.limit]        cap on candidates to probe (0 = unlimited)
 * @returns {Promise<{total:number, live:number, nodes:Array, bySource:Object}>}
 */
async function pullFreshProxies({ concurrency = 24, timeoutMs = 8000, limit = 400, maxLatencyMs = 5000 } = {}) {
  const { candidates, bySource } = await fetchSources();
  const pool = limit > 0 ? candidates.slice(0, limit) : candidates;

  const probed = await mapLimit(pool, concurrency, async (c) => {
    const r = await checkProxy(c.proxy, timeoutMs);
    return { ...c, ok: r.ok, ms: r.ms };
  });

  const live = probed.filter((p) => p.ok && p.ms <= maxLatencyMs);
  const ips = [...new Set(live.map((p) => p.host).filter(Boolean))];
  const geo = await enrichBulk(ips);

  const seen = new Set();
  const nodes = [];
  for (const p of live) {
    const g = geo[p.host] || {};
    const org = normalizeOrg(g.org) || (p.hintCountry ? `${p.hintCountry} (unnamed)` : 'Generic');
    const cc = ((g.cc || 'XX') || '').toUpperCase() || 'XX';
    const country = g.country || p.hintCountry || 'Unknown';

    const baseId = `${cc.toLowerCase()}-${slug(org)}`;
    let id = baseId;
    let suffix = 1;
    while (seen.has(id)) id = `${baseId}-${suffix++}`;
    seen.add(id);

    nodes.push({
      id,
      cc,
      country,
      provider: org,
      name: `${country} - ${org}`,
      flag: cc,
      proxy: p.proxy,
      lat: p.ms,
    });
  }

  return { total: candidates.length, live: nodes.length, nodes, bySource };
}

module.exports = { pullFreshProxies };
