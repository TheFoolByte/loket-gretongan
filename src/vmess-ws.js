'use strict';

const WebSocket = require('ws');

function attachVmess(client, { port, path = '/vmess', maxQueuedBytes = 1024 * 1024, stats = null, onActivity = () => {} } = {}) {
  if (!Number.isInteger(Number(port)) || Number(port) < 1) throw new Error('VMess inbound port is required');
  const upstream = new WebSocket(`ws://127.0.0.1:${Number(port)}${path}`, {
    handshakeTimeout: 5000,
    maxPayload: 16 * 1024 * 1024,
  });
  let queued = [];
  let queuedBytes = 0;
  let closed = false;
  const countBytes = (key, data) => {
    if (!stats) return;
    const size = Buffer.isBuffer(data) ? data.length : Buffer.byteLength(String(data));
    stats[key] = (stats[key] || 0) + size;
  };

  const closeBoth = (code = 1000, reason = '') => {
    if (closed) return;
    closed = true;
    queued = [];
    queuedBytes = 0;
    if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) client.close(code, reason);
    if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) upstream.close(code, reason);
  };

  const sendUpstream = (data, isBinary) => {
    onActivity();
    countBytes('vmessRx', data);
    if (upstream.readyState === WebSocket.OPEN) {
      upstream.send(data, { binary: isBinary }, (err) => { if (err) closeBoth(1011, 'VMess relay error'); });
      return;
    }
    const size = Buffer.isBuffer(data) ? data.length : Buffer.byteLength(String(data));
    queuedBytes += size;
    if (queuedBytes > maxQueuedBytes) return closeBoth(1013, 'VMess relay busy');
    queued.push({ data, isBinary, size });
  };

  client.on('message', sendUpstream);
  upstream.on('open', () => {
    if (client.readyState !== WebSocket.OPEN) return closeBoth();
    for (const item of queued) {
      upstream.send(item.data, { binary: item.isBinary }, (err) => { if (err) closeBoth(1011, 'VMess relay error'); });
      if (closed) return;
    }
    queued = [];
    queuedBytes = 0;
  });
  upstream.on('message', (data, isBinary) => {
    onActivity();
    countBytes('vmessTx', data);
    if (client.readyState === WebSocket.OPEN) {
      client.send(data, { binary: isBinary }, (err) => { if (err) closeBoth(1011, 'VMess relay error'); });
    }
  });
  client.on('close', () => closeBoth());
  upstream.on('close', () => closeBoth());
  client.on('error', () => closeBoth(1011, 'VMess relay error'));
  upstream.on('error', () => closeBoth(1011, 'VMess backend unavailable'));
  return upstream;
}

module.exports = { attachVmess };
