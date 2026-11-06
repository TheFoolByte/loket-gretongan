/**
 * Usage accounting + blocklists.
 *
 * Attribution sources:
 *   - VLESS / Trojan websockets → exact username (uuid / secret hash)
 *   - SSH              → dropbear auth log line (username + client ip)
 *   - any connection   → client ip (x-forwarded-for)
 *
 * Writing to disk on every packet would be silly, so counters live in memory and
 * a debounced flush persists them next to users.json.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const FLUSH_MS = 15_000;

class Usage {
  constructor({ dataDir = process.env.DATA_DIR || '/data' } = {}) {
    this.file = path.join(dataDir, 'usage.json');
    this.data = this._load();
    this.dirty = false;
    this.timer = setInterval(() => this.flush(), FLUSH_MS);
    this.timer.unref?.();
  }

  _load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return {
        users: parsed.users || {},
        ips: parsed.ips || {},
        blockedIps: parsed.blockedIps || [],
        blockedUsers: parsed.blockedUsers || [],
        day: parsed.day || {},
      };
    } catch {
      return { users: {}, ips: {}, blockedIps: [], blockedUsers: [], day: {} };
    }
  }

  flush() {
    if (!this.dirty) return;
    const tmp = `${this.file}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(this.data), { mode: 0o600 });
      fs.renameSync(tmp, this.file);
      this.dirty = false;
    } catch {
      /* keep dirty; retry on next tick */
    }
  }

  _user(name) {
    if (!this.data.users[name]) {
      this.data.users[name] = {
        createdAt: new Date().toISOString(),
        lastSeen: null,
        lastIp: null,
        ssh: { bytesIn: 0, bytesOut: 0, logins: 0, lastAt: null },
        vless: { bytesIn: 0, bytesOut: 0, sessions: 0, lastAt: null },
        trojan: { bytesIn: 0, bytesOut: 0, sessions: 0, lastAt: null },
      };
      this.dirty = true;
    }
    return this.data.users[name];
  }

  _ip(ip) {
    if (!this.data.ips[ip]) {
      this.data.ips[ip] = { firstSeen: new Date().toISOString(), lastSeen: null, users: [], conns: 0, blocked: false };
      this.dirty = true;
    }
    return this.data.ips[ip];
  }

  recordSignup({ username, ip }) {
    const u = this._user(username);
    u.lastIp = ip;
    u.lastSeen = new Date().toISOString();
    const rec = this._ip(ip);
    rec.lastSeen = u.lastSeen;
    if (!rec.users.includes(username)) rec.users.push(username);
    this.data.day[ip] = (this.data.day[ip] || 0) + 1;
    this.dirty = true;
  }

  recordAuth({ username, protocol, ip }) {
    if (!username) return;
    const u = this._user(username);
    u.lastSeen = new Date().toISOString();
    u.lastIp = ip || u.lastIp;
    const bucket = u[protocol];
    if (bucket) {
      bucket.lastAt = u.lastSeen;
      if (protocol === 'ssh') bucket.logins += 1;
      else bucket.sessions += 1;
    }
    if (ip) {
      const rec = this._ip(ip);
      rec.lastSeen = u.lastSeen;
      rec.conns += 1;
      if (!rec.users.includes(username)) rec.users.push(username);
    }
    this.dirty = true;
  }

  recordBytes({ username, protocol, bytesIn = 0, bytesOut = 0 }) {
    if (!username) return;
    const bucket = this._user(username)[protocol];
    if (!bucket) return;
    bucket.bytesIn += bytesIn;
    bucket.bytesOut += bytesOut;
    this.dirty = true;
  }

  signupAllowed(ip, { perIp = 2, global = 40 } = {}) {
    if (this.isIpBlocked(ip)) return { allowed: false, reason: 'ip blocked' };
    const used = this.data.day[ip] || 0;
    if (used >= perIp) return { allowed: false, reason: `limit ${perIp}/day per IP reached` };
    const total = Object.values(this.data.day).reduce((a, b) => a + b, 0);
    if (total >= global) return { allowed: false, reason: 'global daily limit reached' };
    return { allowed: true, remaining: perIp - used };
  }

  resetDailyIfNeeded() {
    const today = new Date().toISOString().slice(0, 10);
    if (this.data.dayDate === today) return;
    this.data.dayDate = today;
    this.data.day = {};
    this.dirty = true;
  }

  isIpBlocked(ip) {
    return this.data.blockedIps.includes(ip);
  }

  isUserBlocked(username) {
    return this.data.blockedUsers.includes(username);
  }

  blockIp(ip, block = true) {
    const set = new Set(this.data.blockedIps);
    if (block) set.add(ip);
    else set.delete(ip);
    this.data.blockedIps = [...set];
    if (this.data.ips[ip]) this.data.ips[ip].blocked = block;
    this.dirty = true;
    this.flush();
  }

  blockUser(username, block = true) {
    const set = new Set(this.data.blockedUsers);
    if (block) set.add(username);
    else set.delete(username);
    this.data.blockedUsers = [...set];
    this.dirty = true;
    this.flush();
  }

  ipReport(limit = 200) {
    return Object.entries(this.data.ips)
      .map(([ip, rec]) => ({ ip, ...rec }))
      .sort((a, b) => String(b.lastSeen).localeCompare(String(a.lastSeen)))
      .slice(0, limit);
  }

  userReport(name) {
    return this.data.users[name] || null;
  }
}

module.exports = { Usage };
