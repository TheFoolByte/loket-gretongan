/**
 * User records (JSON, 0600) + privileged OS-account management.
 *
 * The web process runs unprivileged and may only call the whitelisted helper
 * `/usr/local/sbin/loket-user` through sudo. Secrets are handed to the helper
 * on stdin so they never appear in `ps`.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { hashPassword, sha224, newUuid, newSecret } = require('./auth');

const USERNAME_RE = /^[a-z][a-z0-9_-]{2,31}$/;
const HELPER = process.env.LOKET_USER_HELPER || '/usr/local/sbin/loket-user';

class Users {
  constructor({ dataDir = process.env.DATA_DIR || '/data', useHelper = true } = {}) {
    this.dir = dataDir;
    this.file = path.join(dataDir, 'users.json');
    this.useHelper = useHelper && process.env.LOKET_NO_HELPER !== '1';
    this.records = this._load();
  }

  _load() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed.users) ? parsed.users : [];
    } catch {
      return [];
    }
  }

  _save() {
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ users: this.records }, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
    try {
      fs.chmodSync(this.file, 0o600);
    } catch {
      /* best effort */
    }
  }

  list() {
    return this.records.map((u) => this.publicView(u));
  }

  publicView(u) {
    return {
      username: u.username,
      expired: u.expired,
      active: this.isActive(u),
      uuid: u.uuid,
      created: u.created,
    };
  }

  isActive(u) {
    if (!u || u.disabled) return false;
    return !u.expired || u.expired >= new Date().toISOString().slice(0, 10);
  }

  find(username) {
    const name = String(username || '').toLowerCase();
    return this.records.find((u) => u.username === name);
  }

  /** Look up a VLESS client by uuid (binary-safe string compare). */
  findByUuid(uuid) {
    if (!uuid) return null;
    return this.records.find((u) => u.uuid === uuid && this.isActive(u)) || null;
  }

  /** Trojans are matched on the SHA-224 hex of the per-user secret. */
  findByTrojanHash(hash) {
    if (!hash) return null;
    return this.records.find((u) => u.trojanHash === hash && this.isActive(u)) || null;
  }

  _helper(args, stdin) {
    if (!this.useHelper) return;
    try {
      execFileSync('sudo', ['-n', HELPER, ...args], {
        input: stdin === undefined ? '' : `${stdin}\n`,
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 20_000,
      });
    } catch (err) {
      const detail = err.stderr ? String(err.stderr).trim() : err.message;
      throw new Error(`os user ${args[0]} failed: ${detail}`);
    }
  }

  create({ username, password, days = 30 }) {
    const name = String(username || '').toLowerCase().trim();
    if (!USERNAME_RE.test(name)) {
      throw new Error('username: 3-32 chars, lowercase letter first, [a-z0-9_-] only');
    }
    if (typeof password !== 'string' || password.length < 10) {
      throw new Error('password must be at least 10 characters');
    }
    const span = Number(days);
    if (!Number.isInteger(span) || span < 1 || span > 3650) {
      throw new Error('days must be an integer between 1 and 3650');
    }
    if (this.find(name)) throw new Error('user already exists');

    const expired = new Date(Date.now() + span * 86_400_000).toISOString().slice(0, 10);
    this._helper(['add', name, expired], password);

    const record = {
      username: name,
      passHash: hashPassword(password),
      trojanHash: sha224(newSecret(24)),
      trojanSecret: null, // set below, shown once
      uuid: newUuid(),
      expired,
      created: new Date().toISOString(),
      disabled: false,
    };
    const secret = newSecret(24);
    record.trojanSecret = null;
    record.trojanHash = sha224(secret);

    this.records.push(record);
    this._save();
    return { ...this.publicView(record), password, trojanSecret: secret };
  }

  resetPassword(username, password) {
    const record = this.find(username);
    if (!record) throw new Error('user not found');
    if (typeof password !== 'string' || password.length < 10) {
      throw new Error('password must be at least 10 characters');
    }
    this._helper(['passwd', record.username], password);
    record.passHash = hashPassword(password);
    this._save();
    return { ok: true };
  }

  remove(username) {
    const record = this.find(username);
    if (!record) throw new Error('user not found');
    this._helper(['del', record.username]);
    this.records = this.records.filter((u) => u.username !== record.username);
    this._save();
    return { username: record.username, deleted: true };
  }

  /** Drop accounts whose expiry has passed; used by the hourly sweep. */
  pruneExpired() {
    const today = new Date().toISOString().slice(0, 10);
    const dead = this.records.filter((u) => u.expired && u.expired < today);
    for (const u of dead) {
      try {
        this._helper(['del', u.username]);
      } catch {
        /* keep the record so the next sweep retries */
        continue;
      }
      this.records = this.records.filter((x) => x.username !== u.username);
    }
    if (dead.length) this._save();
    return dead.map((u) => u.username);
  }
}

module.exports = { Users, USERNAME_RE };
