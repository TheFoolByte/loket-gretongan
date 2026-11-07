'use strict';

/**
 * Offline ASN + city/geolocation enrichment via MaxMind GeoLite2 (.mmdb).
 * Databases are downloaded once into the volume dir and reused; per-IP lookups
 * are then local (no rate limits). If a database can't be loaded, we fall back
 * to a batched ip-api.com lookup.
 */

const fs = require('node:fs');
const path = require('node:path');
const maxmind = require('maxmind');

const GEO_DIR = process.env.GEO_DIR || path.join(process.env.DATA_DIR || '/data', 'geo');
const ASN_FILE = path.join(GEO_DIR, 'GeoLite2-ASN.mmdb');
const COUNTRY_FILE = path.join(GEO_DIR, 'GeoLite2-Country.mmdb');
const ASN_URL = process.env.GEO_ASN_URL || 'https://github.com/P3TERX/GeoLite.mmdb/raw/download/GeoLite2-ASN.mmdb';
const COUNTRY_URL = process.env.GEO_COUNTRY_URL || 'https://github.com/P3TERX/GeoLite.mmdb/raw/download/GeoLite2-Country.mmdb';

let asnDb = null;
let countryDb = null;
let ready = false;
let loading = null;

async function download(url, dest) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`geo download ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1024) throw new Error('geo download too small');
  fs.mkdirSync(GEO_DIR, { recursive: true });
  const tmp = `${dest}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, dest);
  return buf.length;
}

async function ensureReady() {
  if (ready) return;
  if (loading) return loading;
  loading = (async () => {
    try {
      fs.mkdirSync(GEO_DIR, { recursive: true });
      if (!fs.existsSync(ASN_FILE)) {
        const n = await download(ASN_URL, ASN_FILE);
        console.log(`[geo] downloaded ASN db (${Math.round(n / 1024 / 1024)} MB)`);
      }
      asnDb = await maxmind.open(ASN_FILE);
      // Country is best-effort; ASN is what drives provider names.
      try {
        if (!fs.existsSync(COUNTRY_FILE)) {
          const n = await download(COUNTRY_URL, COUNTRY_FILE);
          console.log(`[geo] downloaded Country db (${Math.round(n / 1024 / 1024)} MB)`);
        }
        countryDb = await maxmind.open(COUNTRY_FILE);
      } catch (err) {
        console.error('[geo] country db unavailable:', err.message);
      }
      ready = true;
    } catch (err) {
      console.error('[geo] offline db unavailable, will fall back to ip-api.com:', err.message);
      ready = true; // mark attempted; enrich() checks db presence
    }
  })();
  await loading;
}

function enrich(ip) {
  const out = { ip, org: null, asn: null, country: null, cc: null, city: null };
  if (asnDb) {
    const a = asnDb.get(ip);
    if (a) {
      out.org = a.autonomous_system_organization || null;
      out.asn = a.autonomous_system_number || null;
    }
  }
  if (countryDb) {
    const c = countryDb.get(ip);
    if (c && c.country) {
      out.cc = c.country.iso_code || null;
      out.country = (c.country.names && c.country.names.en) || null;
    }
  }
  return out;
}

// batched ip-api.com fallback (100 ips/req, 1.2s gap)
async function enrichViaIpApi(ips) {
  const map = {};
  for (let i = 0; i < ips.length; i += 100) {
    const chunk = ips.slice(i, i + 100);
    try {
      const res = await fetch('http://ip-api.com/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(chunk),
      });
      const arr = await res.json();
      for (const r of arr) {
        if (r && r.status === 'success') {
          map[r.query] = {
            ip: r.query,
            org: r.isp || r.org || null,
            asn: null,
            country: r.country || null,
            cc: r.countryCode || null,
            city: r.city || null,
          };
        }
      }
    } catch {
      /* skip batch on error */
    }
    if (i + 100 < ips.length) await new Promise((s) => setTimeout(s, 1200));
  }
  return map;
}

/**
 * Enrich a list of unique IPs.
 * Returns a map: ip -> { org, asn, country, cc, city }.
 */
async function enrichBulk(ips) {
  const uniq = [...new Set(ips.map((i) => String(i).trim()).filter(Boolean))];
  if (!uniq.length) return {};
  await ensureReady();
  if (asnDb) {
    const map = {};
    for (const ip of uniq) map[ip] = enrich(ip);
    return map;
  }
  return enrichViaIpApi(uniq);
}

module.exports = { enrich, enrichBulk, ensureReady };
