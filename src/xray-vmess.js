'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { parseProxy } = require('./upstream');

const execFileAsync = promisify(execFile);
const PRIVATE_IPS = [
  'geoip:private', '0.0.0.0/8', '100.64.0.0/10', '192.0.0.0/24',
  '198.18.0.0/15', '224.0.0.0/4', '240.0.0.0/4', '::/128', '::1/128',
  '64:ff9b:1::/48', '100::/64', '2001:db8::/32',
  'fc00::/7', 'fe80::/10', 'ff00::/8',
];

function userEmail(user) {
  return `${user.username}@loket.invalid`;
}

function xrayClient(user) {
  if (!user || !user.username || !user.uuid) throw new Error('VMess user needs username and UUID');
  return { id: user.uuid, email: userEmail(user), level: 0 };
}

function vmessInbound(tag, port, wsPath, users) {
  return {
    listen: '127.0.0.1',
    port,
    tag,
    protocol: 'vmess',
    settings: { clients: users.map(xrayClient) },
    streamSettings: { network: 'ws', wsSettings: { path: wsPath } },
  };
}

function buildXrayConfig({ users = [], nodes = [], portBase = 15000, apiPort = 10085, wsPath = '/vmess' } = {}) {
  const base = Number(portBase);
  const api = Number(apiPort);
  if (!Number.isInteger(base) || base < 1024 || !Number.isInteger(api) || api < 1024) {
    throw new Error('Xray ports must be valid non-privileged ports');
  }
  if (typeof wsPath !== 'string' || !wsPath.startsWith('/') || wsPath.length > 200) {
    throw new Error('VMess WebSocket path must be a short absolute path');
  }

  const clients = users.filter((u) => u && u.active !== false);
  const directTag = 'vmess-direct';
  const directPort = base;
  const inbounds = [vmessInbound(directTag, directPort, wsPath, clients)];
  const outbounds = [
    { tag: 'block', protocol: 'blackhole', settings: {} },
    { tag: 'direct', protocol: 'freedom', settings: {} },
  ];
  const routingRules = [];
  const inboundTags = [directTag];
  const nodePorts = Object.create(null);
  const nodeSignatures = [];
  let index = 0;

  for (const node of nodes) {
    if (!node || !node.id) throw new Error('Xray node needs an id');
    nodeSignatures.push({ id: node.id, proxy: node.proxy || '' });
    if (!node.proxy) {
      nodePorts[node.id] = directPort;
      continue;
    }

    index += 1;
    const port = base + index;
    if (port > 65535 || port === api) throw new Error('Xray node inbound port range is exhausted or overlaps the API');
    const parsed = parseProxy(node.proxy);
    const inboundTag = `vmess-node-${index}`;
    const outboundTag = `node-egress-${index}`;
    inbounds.push(vmessInbound(inboundTag, port, wsPath, clients));
    inboundTags.push(inboundTag);
    nodePorts[node.id] = port;

    if (parsed.protocol === 'socks5') {
      const server = { address: parsed.host, port: parsed.port };
      if (parsed.username) server.users = [{ user: parsed.username, pass: parsed.password }];
      outbounds.push({ tag: outboundTag, protocol: 'socks', settings: { servers: [server] } });
    } else {
      const settings = { address: parsed.host, port: parsed.port };
      if (parsed.username) {
        settings.user = parsed.username;
        settings.pass = parsed.password;
      }
      outbounds.push({ tag: outboundTag, protocol: 'http', settings });
    }
    routingRules.push({ type: 'field', inboundTag: [inboundTag], outboundTag });
  }

  if (base + index > 65535 || (api >= base && api <= base + index)) {
    throw new Error('Xray API port overlaps its VMess inbound range');
  }
  const udpTags = [...inboundTags];
  routingRules.unshift({ type: 'field', ip: PRIVATE_IPS, outboundTag: 'block' });
  routingRules.splice(1, 0, { type: 'field', network: 'udp', inboundTag: udpTags, outboundTag: 'block' });
  routingRules.push({ type: 'field', inboundTag: [directTag], outboundTag: 'direct' });

  return {
    config: {
      log: { loglevel: 'warning' },
      api: { tag: 'api', listen: `127.0.0.1:${api}`, services: ['HandlerService'] },
      inbounds,
      outbounds,
      routing: { domainStrategy: 'IPOnDemand', rules: routingRules },
    },
    inboundTags,
    directPort,
    nodePorts,
    nodeSignature: JSON.stringify(nodeSignatures),
  };
}

function buildVmessUri({ uuid, username, host, path: wsPath, port = 443, tls = true, label = '' }) {
  if (!uuid || !host || !wsPath) throw new Error('VMess URI needs UUID, host, and WebSocket path');
  const config = {
    v: '2',
    ps: `Loket-${label || username || 'account'}`,
    add: host,
    port: String(port),
    id: uuid,
    aid: '0',
    scy: 'auto',
    net: 'ws',
    type: 'none',
    host,
    path: wsPath,
    tls: tls ? 'tls' : '',
  };
  if (tls) config.sni = host;
  return `vmess://${Buffer.from(JSON.stringify(config), 'utf8').toString('base64')}`;
}

function canConnect(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const timer = setTimeout(() => { socket.destroy(); resolve(false); }, 250);
    socket.once('connect', () => { clearTimeout(timer); socket.destroy(); resolve(true); });
    socket.once('error', () => { clearTimeout(timer); resolve(false); });
  });
}

class XrayVmessManager {
  constructor({
    enabled = false,
    binary = process.env.XRAY_BIN || '/usr/local/bin/xray',
    apiPort = Number(process.env.VMESS_API_PORT || 10085),
    portBase = Number(process.env.VMESS_PORT_BASE || 15000),
    wsPath = '/vmess',
    startupTimeoutMs = 8000,
    onFatal = null,
  } = {}) {
    this.enabled = Boolean(enabled);
    this.binary = binary;
    this.apiPort = apiPort;
    this.apiAddress = `127.0.0.1:${apiPort}`;
    this.portBase = portBase;
    this.wsPath = wsPath;
    this.startupTimeoutMs = startupTimeoutMs;
    this.onFatal = onFatal;
    this.child = null;
    this.exitPromise = null;
    this.stopping = false;
    this.inboundTags = [];
    this.directPort = portBase;
    this.nodePorts = Object.create(null);
    this.nodeSignature = '';
    this.users = new Map();
    this.queue = Promise.resolve();
  }

  _serialize(work) {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => {});
    return next;
  }

  start(users, nodes) {
    if (!this.enabled) return Promise.resolve();
    return this._serialize(() => this._restart(users, nodes));
  }

  sync(users, nodes, { forceRestart = false } = {}) {
    if (!this.enabled) return Promise.resolve();
    return this._serialize(async () => {
      const desired = new Map(users.filter((u) => u && u.active !== false).map((u) => [u.username, u]));
      const signature = JSON.stringify(nodes.map((n) => ({ id: n.id, proxy: n.proxy || '' })));
      const removed = [...this.users.keys()].filter((name) => !desired.has(name));
      const added = [...desired.keys()].filter((name) => !this.users.has(name));
      if (forceRestart || !this.child || signature !== this.nodeSignature || removed.length) {
        return this._restart([...desired.values()], nodes);
      }
      if (!added.length) return;
      try {
        await this._addUsers([...desired.values()].filter((u) => added.includes(u.username)), nodes);
        this.users = desired;
      } catch (err) {
        // A full, fail-closed rebuild also heals any partial HandlerService update.
        await this._restart([...desired.values()], nodes);
      }
    });
  }

  portFor(nodeId) {
    return nodeId && this.nodePorts[nodeId] ? this.nodePorts[nodeId] : this.directPort;
  }

  async _writeConfig(config) {
    const file = path.join(os.tmpdir(), `loket-xray-${process.pid}-${crypto.randomBytes(6).toString('hex')}.json`);
    fs.writeFileSync(file, JSON.stringify(config), { mode: 0o600, flag: 'wx' });
    return file;
  }

  _env() {
    const env = { ...process.env };
    if (!env.XRAY_LOCATION_ASSET && fs.existsSync('/usr/local/share/xray/geoip.dat')) {
      env.XRAY_LOCATION_ASSET = '/usr/local/share/xray';
    }
    return env;
  }

  async _runApi(args, payload) {
    const file = await this._writeConfig(payload);
    try {
      const { stdout = '', stderr = '' } = await execFileAsync(this.binary, ['api', ...args, file], {
        env: this._env(),
        timeout: 10_000,
        maxBuffer: 1024 * 1024,
      });
      return `${stdout}\n${stderr}`;
    } catch (err) {
      throw new Error(`Xray HandlerService command failed (${err.code || 'error'})`);
    } finally {
      try { fs.unlinkSync(file); } catch { /* best effort */ }
    }
  }

  async _addUsers(users, nodes) {
    if (!users.length) return;
    const built = buildXrayConfig({ users, nodes, portBase: this.portBase, apiPort: this.apiPort, wsPath: this.wsPath });
    const output = await this._runApi(['adu', `--server=${this.apiAddress}`], { inbounds: built.config.inbounds });
    const expected = users.length * built.inboundTags.length;
    const count = Number((output.match(/Added\s+(\d+) user\(s\) in total\./i) || [])[1] || 0);
    if (count !== expected) throw new Error(`Xray added ${count} of ${expected} VMess user bindings`);
  }

  async _stopChild() {
    if (!this.child) return;
    const child = this.child;
    this.stopping = true;
    child.kill('SIGTERM');
    await Promise.race([this.exitPromise, new Promise((resolve) => setTimeout(resolve, 2500))]);
    if (child.exitCode === null) {
      child.kill('SIGKILL');
      await Promise.race([this.exitPromise, new Promise((resolve) => setTimeout(resolve, 1000))]);
    }
    if (this.child === child) this.child = null;
    this.exitPromise = null;
    this.stopping = false;
  }

  async _restart(users, nodes) {
    await this._stopChild();
    const built = buildXrayConfig({ users, nodes, portBase: this.portBase, apiPort: this.apiPort, wsPath: this.wsPath });
    const file = await this._writeConfig(built.config);
    const child = spawn(this.binary, ['run', '-c', file], { env: this._env(), stdio: ['ignore', 'ignore', 'pipe'] });
    this.child = child;
    this.stopping = false;
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-4000); });
    this.exitPromise = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
    child.once('error', (err) => {
      if (!this.stopping) this.onFatal?.(new Error(`Xray process error: ${err.message}`));
    });
    child.once('exit', (code, signal) => {
      if (this.child === child && !this.stopping) {
        this.child = null;
        this.onFatal?.(new Error(`Xray exited unexpectedly (${code ?? signal})`));
      }
    });

    const ports = [...new Set([this.apiPort, built.directPort, ...Object.values(built.nodePorts)])];
    const deadline = Date.now() + this.startupTimeoutMs;
    try {
      let ready = false;
      while (Date.now() < deadline) {
        if (child.exitCode !== null) throw new Error(stderr.trim() || `Xray exited (${child.exitCode})`);
        const checks = await Promise.all(ports.map(canConnect));
        if (checks.every(Boolean)) { ready = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (!ready) throw new Error('Xray listeners did not become ready');
      this.inboundTags = built.inboundTags;
      this.directPort = built.directPort;
      this.nodePorts = built.nodePorts;
      this.nodeSignature = built.nodeSignature;
      this.users = new Map(users.filter((u) => u && u.active !== false).map((u) => [u.username, u]));
    } catch (err) {
      await this._stopChild();
      throw new Error(`Xray VMess startup failed: ${err.message}`);
    } finally {
      try { fs.unlinkSync(file); } catch { /* Xray has already loaded it */ }
    }
  }

  stop() {
    return this._serialize(() => this._stopChild());
  }
}

module.exports = { XrayVmessManager, buildXrayConfig, buildVmessUri, userEmail, PRIVATE_IPS };
