#!/bin/bash
# LOKET HARDENED — container entrypoint (root): sshd-equivalent + optional
# tunnel/SNI, then drop to the unprivileged app user for the web tier.
set -Eeuo pipefail

log() { printf '[loket] %s\n' "$*"; }
die() { printf '[loket] ERROR: %s\n' "$*" >&2; exit 1; }

: "${ADMIN_PASS:?ADMIN_PASS is required (min 12 chars)}"
[ "${#ADMIN_PASS}" -ge 12 ] || die "ADMIN_PASS must be at least 12 characters"

DATA_DIR="${DATA_DIR:-/data}"
SSH_PORT="${SSH_PORT:-22}"
PORT="${PORT:-8080}"
ENABLE_SNI="${ENABLE_SNI:-0}"
ENABLE_CLOUDFLARED="${ENABLE_CLOUDFLARED:-1}"

mkdir -p "$DATA_DIR" /run/dropbear /etc/dropbear
chown app:app "$DATA_DIR"
chmod 700 "$DATA_DIR"
touch "$DATA_DIR/users.json"
chown app:app "$DATA_DIR/users.json"
chmod 600 "$DATA_DIR/users.json"

# ---- host keys (persisted in the volume so clients do not see a new identity
#      on every deploy)
HOSTKEY_DIR="$DATA_DIR/hostkeys"
mkdir -p "$HOSTKEY_DIR"
for type in ed25519 rsa; do
  if [ ! -f "$HOSTKEY_DIR/dropbear_${type}_host_key" ]; then
    dropbearkey -t "$type" -f "$HOSTKEY_DIR/dropbear_${type}_host_key" >/dev/null 2>&1 ||
      log "warning: could not generate $type host key"
  fi
done

BANNER="/etc/loket-banner"
cat > "$BANNER" <<'EOF'
=========================================
  LOKET · akses terbatas untuk pemilik
=========================================
EOF

pids=()

start_dropbear() {
  log "dropbear on 0.0.0.0:${SSH_PORT}"
  /usr/sbin/dropbear -F -E -p "0.0.0.0:${SSH_PORT}" -b "$BANNER" -W 65536 \
    -r "$HOSTKEY_DIR/dropbear_rsa_host_key" \
    -r "$HOSTKEY_DIR/dropbear_ed25519_host_key" &
  pids+=("$!")
}

start_web() {
  log "web tier as user app on :${PORT}"
  runuser -u app -- env \
    HOME=/home/app \
    DATA_DIR="$DATA_DIR" \
    PORT="$PORT" \
    SSH_PORT="$SSH_PORT" \
    SSH_WS_PATH="${SSH_WS_PATH:-/ssh-ws}" \
    VLESS_PATH="${VLESS_PATH:-/vless-ws}" \
    TROJAN_PATH="${TROJAN_PATH:-/trojan-ws}" \
    ADMIN_PASS="$ADMIN_PASS" \
    SESSION_SECRET="${SESSION_SECRET:-}" \
    PUBLIC_HOST="${PUBLIC_HOST:-}" \
    COOKIE_SECURE="${COOKIE_SECURE:-1}" \
    LOGIN_LIMIT="${LOGIN_LIMIT:-8}" \
    ALLOW_PRIVATE_TARGETS="${ALLOW_PRIVATE_TARGETS:-0}" \
    node /app/src/server.js &
  pids+=("$!")
}

start_cloudflared() {
  [ "$ENABLE_CLOUDFLARED" = "1" ] || return 0
  [ -n "${CF_TUNNEL_TOKEN:-}" ] || { log "CF_TUNNEL_TOKEN empty — tunnel skipped"; return 0; }
  log "cloudflared tunnel starting"
  cloudflared tunnel run --token "$CF_TUNNEL_TOKEN" --no-autoupdate &
  pids+=("$!")
}

start_sni() {
  [ "$ENABLE_SNI" = "1" ] || return 0
  local pem="$DATA_DIR/stunnel.pem"
  if [ ! -f "$pem" ]; then
    openssl req -new -x509 -days 3650 -nodes -subj "/CN=loket-gateway" \
      -out "$pem" -keyout "$pem" >/dev/null 2>&1
    chmod 600 "$pem"
  fi
  cat > /etc/stunnel/loket.conf <<EOF
foreground = yes
pid =
debug = 4
output = /dev/stdout
[loket-ssh-sni]
accept = 0.0.0.0:${SSH_SSL_PORT:-2443}
connect = 127.0.0.1:${SSH_PORT}
cert = ${pem}
EOF
  log "stunnel SNI on 0.0.0.0:${SSH_SSL_PORT:-2443} -> 127.0.0.1:${SSH_PORT}"
  stunnel /etc/stunnel/loket.conf &
  pids+=("$!")
}

on_term() {
  log "shutting down"
  local pid
  for pid in "${pids[@]}"; do kill -TERM "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
  exit 0
}
trap on_term SIGTERM SIGINT

start_dropbear
start_web
start_cloudflared
start_sni

log "ready"
# Exit as soon as any supervised process dies so Railway restarts the container
# instead of leaving it half-alive.
wait -n "${pids[@]}"
log "a supervised process exited — container will restart"
exit 1
