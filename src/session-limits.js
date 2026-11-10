'use strict';

function positiveInt(value, fallback) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
}

function decrement(map, key) {
  const next = (map.get(key) || 0) - 1;
  if (next > 0) map.set(key, next);
  else map.delete(key);
}

class SessionLimiter {
  constructor({ maxGlobal = 100, maxPerIp = 6, maxPerUser = 3 } = {}) {
    this.maxGlobal = positiveInt(maxGlobal, 100);
    this.maxPerIp = positiveInt(maxPerIp, 6);
    this.maxPerUser = positiveInt(maxPerUser, 3);
    this.active = 0;
    this.perIp = new Map();
    this.perUser = new Map();
  }

  reserve(ip) {
    const ipKey = String(ip || 'unknown');
    if (this.active >= this.maxGlobal) return { ok: false, reason: 'global' };
    if ((this.perIp.get(ipKey) || 0) >= this.maxPerIp) return { ok: false, reason: 'ip' };

    this.active += 1;
    this.perIp.set(ipKey, (this.perIp.get(ipKey) || 0) + 1);
    let userKey = '';
    let released = false;

    return {
      ok: true,
      attachUser: (username) => {
        const key = String(username || '').toLowerCase();
        if (released || !key) return false;
        if (userKey) return userKey === key;
        if ((this.perUser.get(key) || 0) >= this.maxPerUser) return false;
        this.perUser.set(key, (this.perUser.get(key) || 0) + 1);
        userKey = key;
        return true;
      },
      release: () => {
        if (released) return;
        released = true;
        this.active = Math.max(0, this.active - 1);
        decrement(this.perIp, ipKey);
        if (userKey) decrement(this.perUser, userKey);
      },
    };
  }
}

function installIdleTimeout(ws, timeoutMs = 10 * 60 * 1000) {
  const duration = positiveInt(timeoutMs, 10 * 60 * 1000);
  let timer = null;
  let closed = false;
  const clear = () => {
    closed = true;
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const touch = () => {
    if (closed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      if (ws.readyState === ws.OPEN) ws.close(1001, 'idle timeout');
    }, duration);
    timer.unref?.();
  };

  ws.on('message', touch);
  ws.on('ping', touch);
  ws.on('pong', touch);
  ws.once('close', clear);
  ws.once('error', clear);
  touch();
  return touch;
}

module.exports = { SessionLimiter, installIdleTimeout };
