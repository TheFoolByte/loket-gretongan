/**
 * Password + session primitives.
 *
 * - Passwords: scrypt with a per-record salt. Never store plaintext.
 * - Sessions: HMAC-signed opaque id, HttpOnly + SameSite=Strict cookie.
 * - Login throttle: fixed window per IP, in memory (single instance by design).
 */
'use strict';

const crypto = require('node:crypto');

const SCRYPT_KEYLEN = 32;
const SCRYPT_COST = 16384;

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const derived = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN, { N: SCRYPT_COST });
  return `scrypt$${SCRYPT_COST}$${salt}$${derived.toString('hex')}`;
}

function verifyPassword(password, record) {
  if (typeof record !== 'string') return false;
  const [scheme, cost, salt, expected] = record.split('$');
  if (scheme !== 'scrypt' || !salt || !expected) return false;
  let derived;
  try {
    derived = crypto.scryptSync(String(password), salt, Buffer.from(expected, 'hex').length, {
      N: Number(cost) || SCRYPT_COST,
    });
  } catch {
    return false;
  }
  const a = Buffer.from(derived.toString('hex'));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function sha224(value) {
  return crypto.createHash('sha224').update(String(value)).digest('hex');
}

function newUuid() {
  return crypto.randomUUID();
}

/** Short, URL-safe secret for protocol passwords. */
function newSecret(bytes = 12) {
  return crypto.randomBytes(bytes).toString('base64url');
}

class Sessions {
  constructor({ secret, ttlMs = 12 * 60 * 60 * 1000 } = {}) {
    this.secret = secret || crypto.randomBytes(32).toString('hex');
    this.ttlMs = ttlMs;
    this.store = new Map(); // id -> expiresAt
  }

  _sign(id) {
    return crypto.createHmac('sha256', this.secret).update(id).digest('base64url');
  }

  issue() {
    const id = crypto.randomBytes(24).toString('base64url');
    this.store.set(id, Date.now() + this.ttlMs);
    this.sweep();
    return `${id}.${this._sign(id)}`;
  }

  verify(cookieValue) {
    if (typeof cookieValue !== 'string') return false;
    const dot = cookieValue.lastIndexOf('.');
    if (dot <= 0) return false;
    const id = cookieValue.slice(0, dot);
    const sig = cookieValue.slice(dot + 1);
    const expected = this._sign(id);
    if (sig.length !== expected.length) return false;
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
    const expires = this.store.get(id);
    if (!expires || expires < Date.now()) {
      this.store.delete(id);
      return false;
    }
    return true;
  }

  revoke(cookieValue) {
    if (typeof cookieValue !== 'string') return;
    const dot = cookieValue.lastIndexOf('.');
    if (dot > 0) this.store.delete(cookieValue.slice(0, dot));
  }

  sweep() {
    const now = Date.now();
    for (const [id, exp] of this.store) if (exp < now) this.store.delete(id);
  }
}

/** Fixed-window throttle: max `limit` attempts per `windowMs` per key. */
class Throttle {
  constructor({ limit = 8, windowMs = 60_000 } = {}) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.hits = new Map();
  }

  hit(key) {
    const now = Date.now();
    const entry = this.hits.get(key);
    if (!entry || entry.reset < now) {
      this.hits.set(key, { count: 1, reset: now + this.windowMs });
      return { allowed: true, remaining: this.limit - 1 };
    }
    entry.count += 1;
    if (this.hits.size > 5000) this.hits.clear();
    return entry.count > this.limit
      ? { allowed: false, retryAfterMs: entry.reset - now }
      : { allowed: true, remaining: this.limit - entry.count };
  }

  reset(key) {
    this.hits.delete(key);
  }
}

module.exports = { hashPassword, verifyPassword, sha224, newUuid, newSecret, Sessions, Throttle };
