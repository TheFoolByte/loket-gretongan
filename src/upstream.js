/**
 * Upstream egress through a proxy the operator owns.
 *
 * Two transports, both dependency-free:
 *   socks5://user:pass@host:port   (no-auth or user/pass)
 *   http://user:pass@host:port     (CONNECT tunnel)
 *
 * The point is honest multi-region: the relay exits through a proxy you control
 * in another country, so the exit IP really is in that country.
 */
'use strict';

const net = require('node:net');

const TIMEOUT_MS = Number(process.env.EGRESS_TIMEOUT_MS || 8000);

function parseProxy(raw) {
  if (!raw) return null;
  const url = new URL(String(raw));
  const protocol = url.protocol.replace(':', '');
  if (!['socks5', 'socks5h', 'http', 'https'].includes(protocol)) {
    throw new Error(`unsupported proxy scheme: ${protocol}`);
  }
  return {
    protocol: protocol.startsWith('socks') ? 'socks5' : 'http',
    host: url.hostname,
    port: Number(url.port || (protocol.startsWith('socks') ? 1080 : 8080)),
    username: decodeURIComponent(url.username || ''),
    password: decodeURIComponent(url.password || ''),
  };
}

/**
 * One persistent reader per socket. Attaching/removing `data` listeners between
 * handshake steps pauses the stream and can drop the reply that arrives in the
 * gap, so the listener is installed once and buffers from there.
 */
function makeReader(socket, timeoutMs = TIMEOUT_MS) {
  let buffer = Buffer.alloc(0);
  let waiting = null;
  let failure = null;

  const settle = () => {
    if (!waiting) return;
    if (failure) {
      const { reject, timer } = waiting;
      waiting = null;
      clearTimeout(timer);
      reject(failure);
      return;
    }
    if (buffer.length < waiting.n) return;
    const { n, resolve, timer } = waiting;
    waiting = null;
    clearTimeout(timer);
    const out = buffer.subarray(0, n);
    buffer = buffer.subarray(n);
    resolve(out);
  };

  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    settle();
  });
  socket.on('error', (err) => {
    failure = err;
    settle();
  });
  socket.on('close', () => {
    failure = failure || new Error('proxy closed the connection');
    settle();
  });

  return {
    read(n) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          waiting = null;
          reject(new Error('proxy handshake timeout'));
        }, timeoutMs);
        waiting = { n, resolve, reject, timer };
        settle();
      });
    },
    readUntil(delimiter) {
      return new Promise((resolve, reject) => {
        const started = Date.now();
        const tick = () => {
          const index = buffer.indexOf(delimiter);
          if (index >= 0) {
            const out = buffer.subarray(0, index + delimiter.length);
            buffer = buffer.subarray(index + delimiter.length);
            resolve(out.toString('latin1'));
            return;
          }
          if (failure) return reject(failure);
          if (Date.now() - started > timeoutMs) return reject(new Error('proxy response timeout'));
          setTimeout(tick, 10);
        };
        tick();
      });
    },
  };
}

function connectTcp(host, port, timeoutMs = TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('proxy connect timeout'));
    }, timeoutMs);
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.off('error', reject);
      resolve(socket);
    });
    socket.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

const SOCKS5_NO_AUTH = 0x00;
const SOCKS5_USERPASS = 0x02;

async function viaSocks5(proxy, targetHost, targetPort) {
  const socket = await connectTcp(proxy.host, proxy.port);
  const reader = makeReader(socket);
  try {
    const methods = proxy.username ? [SOCKS5_NO_AUTH, SOCKS5_USERPASS] : [SOCKS5_NO_AUTH];
    socket.write(Buffer.from([0x05, methods.length, ...methods]));
    const greeting = await reader.read(2);
    if (greeting[0] !== 0x05) throw new Error('not a socks5 proxy');
    const method = greeting[1];
    if (method === 0xff) throw new Error('proxy rejected auth methods');

    if (method === SOCKS5_USERPASS) {
      const user = Buffer.from(proxy.username);
      const pass = Buffer.from(proxy.password);
      socket.write(Buffer.concat([Buffer.from([0x01, user.length]), user, Buffer.from([pass.length]), pass]));
      const auth = await reader.read(2);
      if (auth[1] !== 0x00) throw new Error('proxy auth failed');
    }

    const hostBuffer = Buffer.from(targetHost);
    const request = Buffer.concat([
      Buffer.from([0x05, 0x01, 0x00, 0x03, hostBuffer.length]),
      hostBuffer,
      Buffer.from([(targetPort >> 8) & 0xff, targetPort & 0xff]),
    ]);
    socket.write(request);
    const reply = await reader.read(4);
    if (reply[1] !== 0x00) throw new Error(`socks5 connect failed (code ${reply[1]})`);

    // Drain the bound address so the socket is positioned at the payload.
    const atyp = reply[3];
    if (atyp === 0x01) await reader.read(4 + 2);
    else if (atyp === 0x04) await reader.read(16 + 2);
    else {
      const [len] = await reader.read(1);
      await reader.read(len + 2);
    }
    return socket;
  } catch (err) {
    socket.destroy();
    throw err;
  }
}

async function viaHttpConnect(proxy, targetHost, targetPort) {
  const socket = await connectTcp(proxy.host, proxy.port);
  const reader = makeReader(socket);
  try {
    const auth = proxy.username
      ? `Proxy-Authorization: Basic ${Buffer.from(`${proxy.username}:${proxy.password}`).toString('base64')}\r\n`
      : '';
    socket.write(
      `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\n${auth}\r\n`,
    );
    const head = await reader.readUntil('\r\n\r\n');
    const status = Number((head.match(/^HTTP\/1\.[01] (\d{3})/) || [])[1]);
    if (status !== 200) throw new Error(`proxy CONNECT rejected (${status || 'no status'})`);
    return socket;
  } catch (err) {
    socket.destroy();
    throw err;
  }
}

/** Open a socket to targetHost:targetPort, optionally through `proxyUrl`. */
async function openEgress({ proxyUrl, host, port, timeoutMs = TIMEOUT_MS }) {
  const proxy = parseProxy(proxyUrl);
  if (!proxy) {
    const socket = net.createConnection({ host, port });
    socket.setNoDelay(true);
    return socket;
  }
  const socket = proxy.protocol === 'socks5' ? await viaSocks5(proxy, host, port) : await viaHttpConnect(proxy, host, port);
  socket.setNoDelay(true);
  return socket;
}

module.exports = { openEgress, parseProxy };
