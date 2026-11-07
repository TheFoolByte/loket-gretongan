/**
 * VLESS / Trojan over WebSocket, with mandatory per-user authentication.
 *
 * Wire formats follow the upstream specs closely enough for v2rayN / Nekobox
 * clients, but — unlike the project this replaces — a relay only starts after
 * the client proves it holds a known uuid (VLESS) or password (Trojan).
 */
'use strict';

const net = require('node:net');
const dgram = require('node:dgram');
const { allowedTarget } = require('./net-guard');

const CMD_TCP = 1;
const CMD_UDP = 3;

const ADDR_IPV4 = 1;
const ADDR_DOMAIN = 2;
const ADDR_IPV6 = 3;

const uuidToString = (buf, offset) => {
  const hex = buf.subarray(offset, offset + 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

function readVlessHeader(buffer) {
  if (buffer.length < 24) return { hasError: true, message: 'short vless header' };
  const version = buffer[0];
  const uuid = uuidToString(buffer, 1);
  const optLength = buffer[17];
  const cmd = buffer[18 + optLength];
  if (cmd !== CMD_TCP && cmd !== CMD_UDP) return { hasError: true, message: 'unsupported command' };

  const portIndex = 19 + optLength;
  const portRemote = buffer.readUInt16BE(portIndex);
  const addressIndex = portIndex + 2;
  const atyp = buffer[addressIndex];
  let addressRemote = '';
  let rawDataIndex = addressIndex + 1;

  if (atyp === ADDR_IPV4) {
    if (buffer.length < rawDataIndex + 4) return { hasError: true, message: 'short ipv4' };
    addressRemote = Array.from(buffer.subarray(rawDataIndex, rawDataIndex + 4)).join('.');
    rawDataIndex += 4;
  } else if (atyp === ADDR_DOMAIN) {
    const len = buffer[rawDataIndex];
    rawDataIndex += 1;
    if (buffer.length < rawDataIndex + len) return { hasError: true, message: 'short domain' };
    addressRemote = buffer.subarray(rawDataIndex, rawDataIndex + len).toString('utf8');
    rawDataIndex += len;
  } else if (atyp === ADDR_IPV6) {
    if (buffer.length < rawDataIndex + 16) return { hasError: true, message: 'short ipv6' };
    const groups = [];
    for (let i = 0; i < 16; i += 2) groups.push(buffer.readUInt16BE(rawDataIndex + i).toString(16));
    addressRemote = groups.join(':');
    rawDataIndex += 16;
  } else {
    return { hasError: true, message: 'unsupported address type' };
  }

  return {
    hasError: false,
    version,
    uuid,
    isUDP: cmd === CMD_UDP,
    addressRemote,
    portRemote,
    rawDataIndex,
    rawClientData: buffer.subarray(rawDataIndex),
  };
}

function readTrojanHeader(buffer) {
  if (buffer.length < 58) return { hasError: true, message: 'short trojan header' };
  const trojanHash = buffer.subarray(0, 56).toString('ascii').toLowerCase();
  if (buffer[56] !== 0x0d || buffer[57] !== 0x0a) return { hasError: true, message: 'bad trojan framing' };

  const cmd = buffer[58];
  if (cmd !== CMD_TCP && cmd !== CMD_UDP) return { hasError: true, message: 'unsupported command' };
  const atyp = buffer[59];
  let addressRemote = '';
  let index = 60;

  if (atyp === ADDR_IPV4) {
    if (buffer.length < index + 4) return { hasError: true, message: 'short ipv4' };
    addressRemote = Array.from(buffer.subarray(index, index + 4)).join('.');
    index += 4;
  } else if (atyp === ADDR_DOMAIN) {
    const len = buffer[index];
    index += 1;
    if (buffer.length < index + len) return { hasError: true, message: 'short domain' };
    addressRemote = buffer.subarray(index, index + len).toString('utf8');
    index += len;
  } else if (atyp === ADDR_IPV6) {
    if (buffer.length < index + 16) return { hasError: true, message: 'short ipv6' };
    const groups = [];
    for (let i = 0; i < 16; i += 2) groups.push(buffer.readUInt16BE(index + i).toString(16));
    addressRemote = groups.join(':');
    index += 16;
  } else {
    return { hasError: true, message: 'unsupported address type' };
  }

  if (buffer.length < index + 2) return { hasError: true, message: 'short port' };
  const portRemote = buffer.readUInt16BE(index);
  index += 2;
  if (buffer[index] === 0x0d && buffer[index + 1] === 0x0a) index += 2;

  return {
    hasError: false,
    trojanHash,
    isUDP: cmd === CMD_UDP,
    addressRemote,
    portRemote,
    rawDataIndex: index,
    rawClientData: buffer.subarray(index),
  };
}

const vlessResponseHeader = (version) => Buffer.from([version, 0]);
const trojanResponseHeader = () => Buffer.from([]);

/**
 * Relay a VLESS/Trojan websocket. `users` decides authorisation; `stats`
 * is a plain object of counters shared with the dashboard.
 */
function attachVless(ws, { kind, users, stats, log = console, isBlocked = () => false, onAuth = () => {}, onUsage = () => {}, connect = (opts) => net.createConnection(opts), egress = null }) {
  let remote = null;
  let user = null;
  let bytesIn = 0;
  let bytesOut = 0;
  let udpSocket = null;
  let closed = false;

  const closeAll = () => {
    if (closed) return;
    closed = true;
    if (user) {
      try {
        onUsage({ username: user.username, bytesIn, bytesOut });
      } catch {
        /* ignore */
      }
    }
    try {
      if (udpSocket) udpSocket.close();
    } catch {
      /* ignore */
    }
    try {
      if (remote) remote.destroy();
    } catch {
      /* ignore */
    }
    try {
      if (ws.readyState === ws.OPEN) ws.close();
    } catch {
      /* ignore */
    }
  };

  ws.on('close', closeAll);
  ws.on('error', closeAll);

  ws.on('message', async (raw) => {
    if (closed) return;
    const chunk = Buffer.from(raw);
    try {
      if (!remote && !udpSocket) {
        stats.rx += chunk.length;
        const header = kind === 'trojan' ? readTrojanHeader(chunk) : readVlessHeader(chunk);
        if (header.hasError) return closeAll();

        user = kind === 'trojan' ? users.findByTrojanHash(header.trojanHash) : users.findByUuid(header.uuid);
        if (!user || isBlocked(user.username)) {
          log.warn(`${kind} auth rejected`);
          user = null;
          return closeAll();
        }
        onAuth({ username: user.username });

        let target;
        try {
          target = await allowedTarget(header.addressRemote);
        } catch (err) {
          log.warn(`blocked outbound ${header.addressRemote}:${header.portRemote} (${err.message})`);
          return closeAll();
        }

        if (header.isUDP) {
          if (egress) {
            log.warn('udp not supported through an upstream proxy');
            return closeAll();
          }
          return startUdp(header, target, chunk);
        }
        return startTcp(header, target);
      }

      if (remote) {
        stats.rx += chunk.length;
        bytesIn += chunk.length;
        remote.write(chunk);
      }
    } catch (err) {
      log.error(`relay error: ${err.message}`);
      closeAll();
    }
  });

  async function startTcp(header, target) {
    let socket;
    try {
      socket = await connect({ host: target.address, port: header.portRemote });
    } catch (err) {
      log.warn(`egress failed ${target.address}:${header.portRemote} (${err.message})`);
      return closeAll();
    }
    remote = socket;
    socket.setNoDelay(true);
    // An upstream handshake returns an already-connected socket: its `connect`
    // event has already fired, so waiting for that event would stall the relay.
    const resp = kind === 'trojan' ? trojanResponseHeader() : vlessResponseHeader(header.version);
    if (resp.length && ws.readyState === ws.OPEN) ws.send(resp);
    if (header.rawClientData.length) socket.write(header.rawClientData);
    socket.on('data', (data) => {
      stats.tx += data.length;
      bytesOut += data.length;
      if (ws.readyState === ws.OPEN) ws.send(data);
    });
    socket.on('error', closeAll);
    socket.on('close', closeAll);
  }

  function startUdp(header, target, firstChunk) {
    udpSocket = dgram.createSocket(target.family === 6 ? 'udp6' : 'udp4');
    const replyHeader = kind === 'trojan' ? trojanResponseHeader() : vlessResponseHeader(header.version);
    let headerSent = false;

    udpSocket.on('message', (msg) => {
      stats.tx += msg.length;
      if (ws.readyState !== ws.OPEN) return;
      ws.send(headerSent ? msg : Buffer.concat([replyHeader, msg]));
      headerSent = true;
    });
    udpSocket.on('error', closeAll);
    udpSocket.send(header.rawClientData.length ? header.rawClientData : firstChunk.subarray(header.rawDataIndex), header.portRemote, target.address);
  }
}

module.exports = { attachVless, readVlessHeader, readTrojanHeader };
