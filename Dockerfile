# LOKET HARDENED — one container: dropbear + node gateway (+ optional stunnel / cloudflared)
FROM node:20-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    NODE_ENV=production \
    PORT=8080 \
    WEB_PORT=8080 \
    SSH_PORT=22 \
    DATA_DIR=/data \
    ENABLE_SNI=0

# cloudflared is pulled by version and verified; no "latest", no unpinned binary.
ARG CF_VERSION=2026.10.7
ARG CF_SHA256=1f99fb518b83dec2ba8d870a7cc991d82a77e6196295a3d2754ba17ab9f91872

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      dropbear \
      stunnel4 \
      openssl \
      ca-certificates \
      curl \
      sudo \
      util-linux \
      procps \
 && curl -fsSL -o /usr/local/bin/cloudflared \
      "https://github.com/cloudflare/cloudflared/releases/download/${CF_VERSION}/cloudflared-linux-amd64" \
 && echo "${CF_SHA256}  /usr/local/bin/cloudflared" | sha256sum -c - \
 && chmod 0755 /usr/local/bin/cloudflared \
 && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# Unprivileged service account. It owns /data and may only run one helper as root.
RUN groupadd --gid 10001 app \
 && useradd --uid 10001 --gid app --create-home --shell /usr/sbin/nologin app \
 && passwd -l app

WORKDIR /app
COPY package.json package-lock.json* /app/
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

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

# 8080 dashboard, 22 ssh, 2443 optional SNI — one Railway TCP proxy can only
# reach one of them; see README "Networking".
EXPOSE 8080 22 2443

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "require('http').get({host:'127.0.0.1',port:process.env.WEB_PORT||8080,path:'/health'},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["/entrypoint.sh"]
