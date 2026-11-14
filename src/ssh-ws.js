/**
 * SSH over WebSocket: a raw byte pipe between the websocket and the container's
 * dropbear listener. Authentication is dropbear's own; this module only adds
 * connection accounting and a per-IP cap so one client cannot exhaust the box.
 */
'use strict';

const net = require('node:net');

const MAX_PER_IP = Number(process.env.SSH_WS_MAX_PER_IP || process.env.WS_MAX_PER_IP || 6);

function attachSsh(ws, { ip = 'unknown', targetHost, targetPort, stats, log = console, onActivity = () => {} }) {
  const clientIp = String(ip || 'unknown');
  const open = (stats.perIp.get(clientIp) || 0) + 1;
  if (open > MAX_PER_IP) {
    log.warn(`ssh-ws: too many connections from ${clientIp}`);
    ws.close(1013, 'too many connections');
    return;
  }
  stats.perIp.set(clientIp, open);
  stats.activeSsh += 1;

  const socket = net.createConnection({ host: targetHost, port: targetPort });
  socket.setNoDelay(true);

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    stats.activeSsh = Math.max(0, stats.activeSsh - 1);
    const remaining = (stats.perIp.get(clientIp) || 1) - 1;
    if (remaining > 0) stats.perIp.set(clientIp, remaining);
    else stats.perIp.delete(clientIp);
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
    onActivity();
    stats.sshTx += data.length;
    if (ws.readyState === ws.OPEN) ws.send(data);
  });
  socket.on('error', finish);
  socket.on('close', finish);
  ws.on('message', (msg) => {
    onActivity();
    stats.sshRx += msg.length;
    if (!socket.destroyed) socket.write(Buffer.from(msg));
  });
  ws.on('close', finish);
  ws.on('error', finish);
}

module.exports = { attachSsh };
