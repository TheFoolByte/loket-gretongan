# LOKET HARDENED — one container: dropbear + node gateway (+ optional stunnel / cloudflared)
FROM node:20-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    NODE_ENV=production \
    PORT=8080 \
    SSH_PORT=22 \
    DATA_DIR=/data \
    ENABLE_SNI=0 \
    VMESS_ENABLED=1 \
    VMESS_API_PORT=10085 \
    VMESS_PORT_BASE=15000 \
    XRAY_BIN=/usr/local/bin/xray \
    XRAY_LOCATION_ASSET=/usr/local/share/xray

# cloudflared is pulled by version and verified; no "latest", no unpinned binary.
ARG CF_VERSION=2026.10.7
ARG CF_SHA256=1f99fb518b83dec2ba8d870a7cc991d82a77e6196295a3d2754ba17ab9f91872
ARG XRAY_VERSION=26.3.27
ARG XRAY_SHA256=23cd9af937744d97776ee35ecad4972cf4b2109d1e0fe6be9930467608f7c8ae

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      dropbear \
      stunnel4 \
      openssl \
      ca-certificates \
      curl \
      unzip \
      sudo \
      util-linux \
      procps \
 && curl -fsSL -o /usr/local/bin/cloudflared \
      "https://github.com/cloudflare/cloudflared/releases/download/${CF_VERSION}/cloudflared-linux-amd64" \
 && echo "${CF_SHA256}  /usr/local/bin/cloudflared" | sha256sum -c - \
 && chmod 0755 /usr/local/bin/cloudflared \
 && curl -fsSL -o /tmp/xray.zip \
      "https://github.com/XTLS/Xray-core/releases/download/v${XRAY_VERSION}/Xray-linux-64.zip" \
 && echo "${XRAY_SHA256}  /tmp/xray.zip" | sha256sum -c - \
 && mkdir -p /tmp/xray /usr/local/share/xray \
 && unzip -q /tmp/xray.zip xray geoip.dat -d /tmp/xray \
 && install -m 0755 /tmp/xray/xray /usr/local/bin/xray \
 && install -m 0644 /tmp/xray/geoip.dat /usr/local/share/xray/geoip.dat \
 && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# Unprivileged service account. It owns /data and may only run one helper as root.
RUN groupadd --gid 10001 app \
 && useradd --uid 10001 --gid app --create-home --shell /usr/sbin/nologin app \
 && passwd -l app

WORKDIR /app
COPY package.json package-lock.json* /app/
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY src/ /app/src/
COPY nodes.verified.json /app/nodes.verified.json
COPY scripts/ /app/scripts/
COPY entrypoint.sh /entrypoint.sh
COPY scripts/loket-user /usr/local/sbin/loket-user
COPY scripts/sudoers-loket /etc/sudoers.d/loket
COPY scripts/loket-banner /usr/local/sbin/loket-banner

RUN chmod 0755 /entrypoint.sh /usr/local/sbin/loket-user /usr/local/sbin/loket-banner \
 && chown root:root /usr/local/sbin/loket-user /etc/sudoers.d/loket \
 && chmod 0440 /etc/sudoers.d/loket \
 && visudo -cf /etc/sudoers.d/loket \
 && chown -R app:app /app

# Web, SSH, and optional SNI ports. A provider must explicitly support/publish raw
# TCP for SSH/SNI; Xray VMess listeners remain loopback-only.
EXPOSE 8080 22 2443

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "require('http').get({host:'127.0.0.1',port:process.env.WEB_PORT||process.env.PORT||8080,path:'/health'},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["/entrypoint.sh"]
