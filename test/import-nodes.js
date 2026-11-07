'use strict';

const assert = require('node:assert');
const { parseProxyReport } = require('../scripts/import-nodes');

const report = `Proxy Check
Proxy → 43.160.222.70:3128
Status → Live
Loc → Singapore (SG) · Singapore
Proxy → 107.172.241.122:12345:tickets:proxyon145|<nil>|Unknown
Status → Live
Loc → United States (US) · Los Angeles
Proxy → 1.2.3.4:1080:u:p
Status → Dead (Connection failed)
Proxy → 5.6.7.8:1080:u:p
Status → Live
Loc → United States (US) · New York City
Proxy → 9.9.9.9:8080
Status → Live
Loc → Japan (JP) · Tokyo
`;

// Auto scheme: 1080/10808 → socks5, and a socks-port endpoint is preferred per country.
const auto = parseProxyReport(report);
assert.deepEqual(auto.nodes, [
  { id: 'sg', name: 'Singapore', flag: 'SG', proxy: 'http://43.160.222.70:3128' },
  { id: 'us', name: 'United States', flag: 'US', proxy: 'socks5://u:p@5.6.7.8:1080' },
]);
assert.deepEqual(auto.missing, ['MY'], 'missing region is reported, not replaced by another country');

// Forced http: first live node wins, no socks preference.
const forcedHttp = parseProxyReport(report, { scheme: 'http' });
assert.equal(forcedHttp.nodes.find((n) => n.id === 'us').proxy, 'http://tickets:proxyon145@107.172.241.122:12345');

// Forced socks5: transport overrides the port.
const forcedSocks = parseProxyReport(report, { regions: ['US'], scheme: 'socks5' });
assert.equal(forcedSocks.nodes[0].proxy, 'socks5://tickets:proxyon145@107.172.241.122:12345');

// '*' selects every live country, sorted by id.
const all = parseProxyReport(report, { regions: ['*'] });
assert.deepEqual(all.nodes.map((n) => n.id), ['jp', 'sg', 'us']);
assert.equal(all.missing.length, 0);

// Custom socks-port list overrides the default.
const custom = parseProxyReport(report, { regions: ['SG'], socksPorts: [3128] });
assert.equal(custom.nodes[0].proxy, 'socks5://43.160.222.70:3128');

assert.throws(() => parseProxyReport(report, { scheme: 'https' }), /scheme/);
assert.throws(() => parseProxyReport(report, { regions: ['Singapore'] }), /country codes/);

console.log('proxy report import: all assertions passed');
