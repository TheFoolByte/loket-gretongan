/**
 * SSH over WebSocket: a raw byte pipe between the websocket and the container's
 * dropbear listener. Authentication is dropbear's own; this module only adds
 * connection accounting and a per-IP cap so one client cannot exhaust the box.
 */
'use strict';

const net = require('node:net');

const MAX_PER_IP = Number(process.env.SSH_WS_MAX_PER_IP || 6);

function attachSsh(ws, { req, targetHost, targetPort, stats, log = console }) {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '')
    .split(',')[0]
    .trim();
  const open = (stats.perIp.get(ip) || 0) + 1;
  if (open > MAX_PER_IP) {
    log.warn(`ssh-ws: too many connections from ${ip}`);
    stats.perIp.set(ip, open);
    ws.close(1013, 'too many connections');
    return;
  }
  stats.perIp.set(ip, open);
  stats.activeSsh += 1;

  const socket = net.createConnection({ host: targetHost, port: targetPort });
  socket.setNoDelay(true);

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    stats.activeSsh = Math.max(0, stats.activeSsh - 1);
    const remaining = (stats.perIp.get(ip) || 1) - 1;
    if (remaining > 0) stats.perIp.set(ip, remaining);
    else stats.perIp.delete(ip);
    try {
      socket.destroy();
    } catch {
      /* ignore */
    }
    try {
      if (ws.readyState === ws.OPEN) ws.close();
    } catch {
      /* ignore */
    }
  };

  socket.on('data', (data) => {
    stats.sshTx += data.length;
    if (ws.readyState === ws.OPEN) ws.send(data);
  });
  socket.on('error', finish);
  socket.on('close', finish);
  ws.on('message', (msg) => {
    stats.sshRx += msg.length;
    if (!socket.destroyed) socket.write(Buffer.from(msg));
  });
  ws.on('close', finish);
  ws.on('error', finish);
}

module.exports = { attachSsh };
