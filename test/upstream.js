/**
 * Upstream egress tests: mock SOCKS5 (with auth) and mock HTTP CONNECT proxies.
 * Every step has a timeout, so a broken handshake fails instead of hanging.
 *
 *   node test/upstream.js
 */
'use strict';

const assert = require('node:assert');
const net = require('node:net');
const { openEgress } = require('../src/upstream');
const { loadNodes } = require('../src/nodes');

const TIMEOUT = 4000;

const listen = (server) =>
  new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));

/** Buffered reader: pull exactly N bytes, or fail after a timeout. */
function reader(socket) {
  let buffer = Buffer.alloc(0);
  let waiting = null;

  const flush = () => {
    if (!waiting) return;
    if (buffer.length >= waiting.n) {
      const { n, resolve, timer } = waiting;
      waiting = null;
      clearTimeout(timer);
      const out = buffer.subarray(0, n);
      buffer = buffer.subarray(n);
      resolve(out);
    }
  };

  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    flush();
  });
  socket.on('error', () => {});

  return (n) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('mock read timeout')), TIMEOUT);
      waiting = { n, resolve, timer };
      flush();
    });
}

/** SOCKS5 CONNECT proxy; optionally requires user/pass. */
function socksServer({ user, pass } = {}) {
  return net.createServer(async (client) => {
    try {
      const read = reader(client);
      const greeting = await read(2);
      assert.equal(greeting[0], 0x05);
      await read(greeting[1]); // method list

      if (user) {
        client.write(Buffer.from([0x05, 0x02]));
        const head = await read(2);
        assert.equal(head[0], 0x01);
        const ulen = head[1];
        const username = (await read(ulen)).toString();
        const plen = (await read(1))[0];
        const password = (await read(plen)).toString();
        const ok = username === user && password === pass;
        client.write(Buffer.from([0x01, ok ? 0x00 : 0x01]));
        if (!ok) return client.destroy();
      } else {
        client.write(Buffer.from([0x05, 0x00]));
      }

      const req = await read(4);
      const atyp = req[3];
      let host;
      if (atyp === 0x03) {
        const len = (await read(1))[0];
        host = (await read(len)).toString();
      } else if (atyp === 0x01) {
        host = Array.from(await read(4)).join('.');
      } else {
        return client.destroy();
      }
      const port = (await read(2)).readUInt16BE(0);

      const upstream = net.createConnection({ host, port }, () => {
        client.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
        client.pipe(upstream);
        upstream.pipe(client);
      });
      upstream.on('error', () => client.destroy());
      client.on('error', () => {});
    } catch {
      client.destroy();
    }
  });
}

/** HTTP CONNECT proxy with optional basic auth. */
function httpProxy({ user, pass } = {}) {
  return net.createServer((client) => {
    let buffer = '';
    const onData = (chunk) => {
      buffer += chunk.toString('latin1');
      if (!buffer.includes('\r\n\r\n')) return;
      client.off('data', onData);
      const first = (buffer.split('\r\n')[0] || '').trim();
      const target = (first.match(/^CONNECT (\S+) HTTP\/1\.[01]$/) || [])[1];
      if (!target) return client.destroy();
      if (user) {
        const expected = `Proxy-Authorization: Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
        if (!buffer.includes(expected)) {
          client.write('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n');
          return client.destroy();
        }
      }
      const [host, port] = target.split(':');
      const upstream = net.createConnection({ host, port: Number(port) }, () => {
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        client.pipe(upstream);
        upstream.pipe(client);
      });
      upstream.on('error', () => client.destroy());
    };
    client.on('data', onData);
    client.on('error', () => {});
  });
}

function roundTrip(socket, payload = 'ping') {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('echo timeout')), TIMEOUT);
    socket.once('data', (d) => {
      clearTimeout(timer);
      resolve(d.toString());
    });
    socket.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    socket.write(payload);
  });
}

(async () => {
  const echo = net.createServer((socket) => socket.on('data', (d) => socket.write(Buffer.concat([Buffer.from('echo:'), d]))));
  const echoPort = await listen(echo);
  const closers = [echo];

  try {
    const socks = socksServer({ user: 'u1', pass: 'p1' });
    const socksPort = await listen(socks);
    closers.push(socks);

    const viaSocks = await openEgress({
      proxyUrl: `socks5://u1:p1@127.0.0.1:${socksPort}`,
      host: '127.0.0.1',
      port: echoPort,
    });
    assert.equal(await roundTrip(viaSocks), 'echo:ping', 'socks5 relay round-trip');
    viaSocks.destroy();
    console.log('socks5 auth + relay: ok');

    await assert.rejects(
      () => openEgress({ proxyUrl: `socks5://u1:wrong@127.0.0.1:${socksPort}`, host: '127.0.0.1', port: echoPort }),
      /auth failed/i,
      'bad socks password must be rejected',
    );
    console.log('socks5 bad password: rejected');

    const proxy = httpProxy({ user: 'u2', pass: 'p2' });
    const httpPort = await listen(proxy);
    closers.push(proxy);

    const viaHttp = await openEgress({
      proxyUrl: `http://u2:p2@127.0.0.1:${httpPort}`,
      host: '127.0.0.1',
      port: echoPort,
    });
    assert.equal(await roundTrip(viaHttp), 'echo:ping', 'http connect relay round-trip');
    viaHttp.destroy();
    console.log('http connect auth + relay: ok');

    const direct = await openEgress({ proxyUrl: null, host: '127.0.0.1', port: echoPort });
    assert.equal(await roundTrip(direct), 'echo:ping', 'direct egress round-trip');
    direct.destroy();
    console.log('direct egress: ok');

    const nodes = loadNodes(JSON.stringify([
      { id: 'sg', name: 'Singapore', flag: 'SG', proxy: 'socks5://a:b@10.0.0.1:1080' },
      { id: 'bad id', name: 'x' },
      { id: 'sg', name: 'dup' },
    ]));
    assert.equal(nodes.length, 1, 'invalid and duplicate node ids dropped');
    assert.equal(nodes[0].id, 'sg');
    assert.equal(loadNodes('').length, 0, 'empty env = direct only');
    assert.equal(loadNodes('not json').length, 0, 'broken json ignored');
    console.log('node registry: ok');

    console.log('\nupstream: all assertions passed');
  } catch (err) {
    console.error('\nupstream FAILED:', err.message);
    process.exitCode = 1;
  } finally {
    for (const server of closers) server.close();
    setTimeout(() => process.exit(process.exitCode || 0), 300).unref();
  }
})();
