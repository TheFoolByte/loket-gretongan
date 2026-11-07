#!/usr/bin/env node
/**
 * Convert a Proxy Check report into the existing NODES format.
 *
 * The report does not say whether an endpoint is HTTP or SOCKS5. In `auto`
 * mode the port decides: 1080/10808 (and whatever else you pass via
 * --socks-ports) is treated as SOCKS5, everything else as HTTP. `--scheme http`
 * or `--scheme socks5` force one transport for every node. No proxy is
 * contacted here, so importing stays offline.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

function parseProxyReport(text, {
  regions = ['SG', 'MY', 'US'],
  scheme = 'auto',
  socksPorts = [1080, 10808],
} = {}) {
  if (!['auto', 'http', 'socks5'].includes(scheme)) throw new Error('scheme must be auto, http or socks5');
  const socksSet = new Set((socksPorts || []).map(Number));
  const allRegions = !regions || regions.length === 0 || regions.includes('*');
  const wanted = allRegions ? null : [...new Set(regions.map((region) => String(region).toUpperCase()))];
  if (wanted && (wanted.length === 0 || wanted.some((region) => !/^[A-Z]{2}$/.test(region)))) {
    throw new Error('regions must be comma-separated ISO country codes (or * for all)');
  }

  const byCountry = new Map();
  let current = null;
  for (const line of String(text).split(/\r?\n/)) {
    const match = line.match(/^(Proxy|Status|Loc) → (.+)$/);
    if (!match) continue;
    if (match[1] === 'Proxy') {
      const fields = match[2].trim().split('|')[0].split(':');
      const host = fields[0];
      const port = Number(fields[1]);
      if (![2, 4].includes(fields.length) || !host || !Number.isInteger(port) || port < 1 || port > 65535) {
        current = null;
        continue;
      }
      current = {
        host,
        port,
        username: fields.length === 4 ? fields[2] : '',
        password: fields.length === 4 ? fields[3] : '',
      };
    } else if (current && match[1] === 'Status') {
      current.status = match[2].trim();
    } else if (current && match[1] === 'Loc') {
      current.location = match[2].trim();
      const country = current.location.match(/\(([A-Z]{2})\)/)?.[1];
      if (country && current.status === 'Live' && (allRegions || wanted.includes(country))) {
        if (!byCountry.has(country)) byCountry.set(country, []);
        byCountry.get(country).push({ ...current, country });
      }
      current = null;
    }
  }

  // One node per country. In auto mode a socks-port endpoint is preferred so its
  // transport is recognised; otherwise the first live endpoint wins.
  const nodes = [];
  const seen = [];
  for (const [country, list] of byCountry) {
    const pick = scheme === 'auto' ? list.find((n) => socksSet.has(n.port)) || list[0] : list[0];
    const proto = scheme === 'auto' ? (socksSet.has(pick.port) ? 'socks5' : 'http') : scheme;
    const auth = pick.username ? `${encodeURIComponent(pick.username)}:${encodeURIComponent(pick.password)}@` : '';
    nodes.push({
      id: country.toLowerCase(),
      name: pick.location.split('(')[0].trim().slice(0, 32),
      flag: country,
      proxy: `${proto}://${auth}${pick.host}:${pick.port}`,
    });
    seen.push(country);
  }
  nodes.sort((a, b) => a.id.localeCompare(b.id));
  const missing = wanted ? wanted.filter((region) => !seen.includes(region)) : [];
  return { nodes, missing };
}

function usage() {
  return 'Usage: node scripts/import-nodes.js <input.txt> <output.json> [--regions SG,MY,US|*] [--scheme auto|http|socks5] [--socks-ports 1080,10808]';
}

function main(argv) {
  if (argv.length < 2) throw new Error(usage());
  const [input, output, ...options] = argv;
  const readOption = (name, fallback) => {
    const index = options.indexOf(name);
    if (index < 0) return fallback;
    if (index + 1 >= options.length) throw new Error(`${name} needs a value`);
    return options[index + 1];
  };
  const { nodes, missing } = parseProxyReport(fs.readFileSync(input, 'utf8'), {
    regions: readOption('--regions', 'SG,MY,US').split(','),
    scheme: readOption('--scheme', 'auto'),
    socksPorts: readOption('--socks-ports', '1080,10808').split(',').map(Number),
  });
  if (!nodes.length) throw new Error('no live proxy matched the requested regions');
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(nodes, null, 2)}\n`, { mode: 0o600 });
  console.log(`wrote ${nodes.length} node(s) to ${output}`);
  if (missing.length) console.warn(`no live proxy for: ${missing.join(', ')}`);
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}

module.exports = { parseProxyReport };
