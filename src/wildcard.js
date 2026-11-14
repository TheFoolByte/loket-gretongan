'use strict';

const net = require('node:net');

function parseHost(value, { allowPort = false } = {}) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  let url;
  try { url = new URL(raw.includes('://') ? raw : `http://${raw}`); } catch { return ''; }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return '';
  if (!allowPort && url.port) return '';
  return url.hostname.toLowerCase().replace(/\.$/, '');
}

function normalizeDomain(value) {
  const raw = String(value || '').trim().replace(/^\*\./, '');
  if (!raw) return '';
  const host = parseHost(raw);
  if (!host || net.isIP(host) || !host.includes('.')) {
    throw new Error('WILDCARD_DOMAIN must be a DNS hostname without scheme, port, or path');
  }
  return host;
}

function normalizePublicHost(value) {
  return parseHost(value, { allowPort: false });
}

function hostForNode(nodeId, wildcardDomain, publicHost = '') {
  const base = wildcardDomain || normalizePublicHost(publicHost) || 'localhost';
  if (!nodeId || !wildcardDomain) return base;
  const label = String(nodeId).toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/.test(label)) return base;
  return `${label}.${wildcardDomain}`;
}

function matchWildcardHost(hostHeader, wildcardDomain, nodeById) {
  if (!wildcardDomain) return { matched: false, invalid: false, node: null };
  const host = parseHost(hostHeader, { allowPort: true });
  if (!host) return { matched: false, invalid: false, node: null };
  if (host === wildcardDomain) return { matched: true, invalid: false, node: null };
  const suffix = `.${wildcardDomain}`;
  if (!host.endsWith(suffix)) return { matched: false, invalid: false, node: null };
  const label = host.slice(0, -suffix.length);
  if (!label || label.includes('.')) return { matched: true, invalid: true, node: null };
  const node = nodeById.get(label);
  return node
    ? { matched: true, invalid: false, node }
    : { matched: true, invalid: true, node: null };
}

module.exports = { normalizeDomain, normalizePublicHost, hostForNode, matchWildcardHost };
