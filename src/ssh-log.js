/**
 * Dropbear auth tap.
 *
 * Raw SSH/TCP ingress bypasses the web tier, so the only way to attribute a
 * login is dropbear's own log. entrypoint.sh redirects dropbear to
 * $DATA_DIR/dropbear.log; this module tails it and reports successful logins.
 */
'use strict';

const fs = require('node:fs');

const LINE = /auth succeeded for '([^']+)' from ([0-9a-fA-F:.]+):\d+/;

function tailDropbear({ file, onLogin, log = console }) {
  let offset = 0;
  try {
    offset = fs.statSync(file).size;
  } catch {
    offset = 0;
  }

  const read = () => {
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      return;
    }
    if (stat.size < offset) offset = 0; // rotated/truncated
    if (stat.size === offset) return;
    const length = stat.size - offset;
    const buffer = Buffer.alloc(length);
    let fd;
    try {
      fd = fs.openSync(file, 'r');
      fs.readSync(fd, buffer, 0, length, offset);
    } catch {
      return;
    } finally {
      if (fd !== undefined) {
        try {
          fs.closeSync(fd);
        } catch {
          /* ignore */
        }
      }
    }
    offset = stat.size;
    for (const line of buffer.toString('utf8').split('\n')) {
      const match = line.match(LINE);
      if (match) {
        try {
          onLogin({ username: match[1], ip: match[2] });
        } catch (err) {
          log.warn(`ssh-log: ${err.message}`);
        }
      }
    }
  };

  const timer = setInterval(read, 2000);
  timer.unref?.();
  read();
  return () => clearInterval(timer);
}

module.exports = { tailDropbear };
