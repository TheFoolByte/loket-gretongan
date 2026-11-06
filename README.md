# LOKET GRETONGAN

> *"loketnya satu, gretongannya buat yang punya."* — gateway pribadi, bukan layanan publik.

Satu container Railway untuk: **dashboard web**, **SSH over WebSocket**, **VLESS-WS**,
**Trojan-WS**, dan opsional **SSH-SNI (stunnel)** + **Cloudflare Tunnel**.

Ditulis ulang dari nol. Bukan fork dari project publik mana pun.

Nama `gretongan` cuma lelucon internal — jangan dipakai di domain, banner, atau nama service.

## Kenapa ada versi ini

Versi yang beredar di GitHub punya tiga masalah yang bikin Railway kamu bisa diambil alih:

| Masalah di versi lama | Di sini |
|---|---|
| `requireAdmin()` di-hardcode `return true` → API user terbuka | Semua `/api/*` butuh session cookie bertanda tangan + CSRF |
| VLESS/Trojan relay tanpa cek UUID → open proxy | UUID/password per user wajib valid sebelum relay |
| Relay bebas ke alamat internal | Outbound guard: blokir RFC1918, loopback, link-local, metadata |
| Password user plaintext, world-readable | Hanya hash scrypt; file `0600`; password tak pernah dikembalikan API |
| Token Cloudflare ikut ke-commit & di-`COPY` ke image | Semua secret dari env; image tidak memuat file secret |
| Node jalan sebagai root | Web tier user `app` (UID 10001); aksi OS lewat 1 helper sudo |
| `cloudflared` versi `latest` tanpa checksum | Versi + SHA-256 dipin di Dockerfile |

## Deploy

```bash
git init && git add -A && git commit -m "loket hardened"
git remote add origin <repo-kamu> && git push -u origin main
```

Railway → **New Project → Deploy from GitHub** → pilih repo → tambahkan:

1. **Variables** (wajib: `ADMIN_PASS`, min 12 karakter)
   ```env
   ADMIN_PASS=<openssl rand -base64 24>
   SESSION_SECRET=<openssl rand -hex 32>
   PUBLIC_HOST=domain-kamu.up.railway.app
   ```
2. **Volume** → mount path **`/data`** (host key SSH + `users.json` ikut tersimpan)
3. **Networking**:
   - Public domain → port **8080** (dashboard)
   - **TCP Proxy** → port **22** (SSH langsung)
   - Kalau mau SSH-WS tanpa TCP proxy: isi `CF_TUNNEL_TOKEN` dan arahkan tunnel ke `http://localhost:8080`

> Satu service Railway hanya punya **satu** TCP proxy. Kalau butuh SSH-SNI (2443)
> *dan* SSH langsung (22) sekaligus, pakai Cloudflare Tunnel untuk salah satunya,
> atau pisahkan jadi dua service.

## Panel

| Path | Siapa | Isi |
|---|---|---|
| `/` | publik | generator config: pilih masa aktif → akun + SSH/VLESS/Trojan + QR, langsung tampil |
| `/admin` | admin (`ADMIN_PASS`) | daftar user + IP + volume per protokol, blok IP, blok/hapus user |

Pembatas publik: `SIGNUP_PER_IP` akun per 24 jam per IP, `SIGNUP_DAILY` total harian,
`SIGNUP_MAX_DAYS` batas masa aktif, `SIGNUP_BURST` percobaan per 10 menit.
Semua signup tercatat: IP, user-agent, protokol, volume.

SSH tidak lewat web tier, jadi login SSH diatribusikan dari log dropbear
(`/data/dropbear.log`); VLESS/Trojan diatribusikan dari UUID/password masing-masing user.

## Pakai

1. Buka `https://<domain>/` → login `ADMIN_PASS`.
2. **Buat user** → dapat username, password (sekali), dan **Trojan secret** (sekali).
3. SSH:
   ```bash
   ssh -p <PORT_TCP_PROXY> <user>@<HOST_TCP_PROXY>
   ```
4. VLESS/Trojan (v2rayN / NekoBox):
   - path: `/vless-ws` · uuid = kolom *VLESS uuid* di dashboard
   - path: `/trojan-ws` · password = Trojan secret saat user dibuat

## Keamanan yang perlu kamu tahu

- **Tidak ada password default.** Container menolak boot tanpa `ADMIN_PASS` ≥ 12 karakter.
- **Rate limit login**: 8 percobaan/menit/IP (`LOGIN_LIMIT`).
- **Relay privat diblokir** kecuali `ALLOW_PRIVATE_TARGETS=1` (jangan diaktifkan di Railway).
- **User SSH tidak punya sudo.** Helper `loket-user` hanya bisa `add/passwd/del`.
- **Password & Trojan secret hanya tampil sekali.** Kalau hilang → reset password / buat user baru.
- `users.json` mode `0600`, milik `app`. Host key SSH persisten di `/data/hostkeys`.

## Development

```bash
npm install
npm test                       # smoke test: auth, CSRF, CRUD, throttle, ws
PORT=8080 ADMIN_PASS=dev-password-123 DATA_DIR=./data \
  LOKET_NO_HELPER=1 COOKIE_SECURE=0 npm start
```

`LOKET_NO_HELPER=1` melewati `useradd` — berguna untuk uji UI tanpa root.

## Struktur

```
src/server.js     HTTP + dashboard + routing websocket
src/auth.js       scrypt, session HMAC, throttle
src/users.js      users.json + pemanggilan helper OS
src/vless.js      parser VLESS/Trojan + relay TCP/UDP (dengan auth)
src/net-guard.js  blokir target privat/metadata
src/ssh-ws.js     pipe websocket -> dropbear
scripts/loket-user  satu-satunya operasi root (sudoers terbatas)
```

## Catatan

Alat ini membuat container kamu jadi gateway jaringan. Pastikan kamu paham
kebijakan penggunaan (AUP) Railway sebelum dipakai untuk trafik yang tidak
kamu kendalikan.
