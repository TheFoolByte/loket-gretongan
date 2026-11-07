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

## Multi-node (exit per negara)

Isi `NODES` dengan proxy yang kamu punya/sewa:

```env
NODES=[{"id":"sg","name":"Singapore","flag":"SG","proxy":"socks5://user:pass@1.2.3.4:1080"},
       {"id":"us","name":"United States","flag":"US","proxy":"http://user:pass@5.6.7.8:8080"}]
```

Alurnya: client tetap menghubungi domain kamu; relay keluar lewat proxy node itu,
jadi **exit IP benar-benar di negara tersebut**. Panel menampilkan pilihan node,
`/admin` menampilkan status + latensi tiap node (`/api/admin/nodes`).

Daftar panjang (banyak negara): taruh array yang sama di file volume
**`/data/nodes.json`** — file menang dari env `NODES`, dan tidak perlu diedit
di panel Railway tiap ganti node (max 48 node).

`nodes.example.json` berisi **semua 27 negara** yang ada di laporan proxy
(1 node per negara). **MY tidak ada di laporan tersebut** — bukan disembunyikan
atau diganti region lain.

Impor laporan scan sendiri secara offline:

```bash
# semua negara, deteksi scheme otomatis dari port (1080/10808 → SOCKS5)
node scripts/import-nodes.js result_proxy.txt nodes.json --regions '*'
# negara tertentu saja
node scripts/import-nodes.js result_proxy.txt nodes.json --regions SG,JP,US
# paksa satu transport untuk semua node
node scripts/import-nodes.js result_proxy.txt nodes.json --scheme socks5
# lalu upload nodes.json ke /data/nodes.json di volume Railway.
```

Deteksi `--scheme auto` (default) menebak protokol dari port: `1080`/`10808`
(dan apa pun yang dikasih via `--socks-ports`) dianggap SOCKS5, sisanya HTTP
CONNECT. Laporan scanner tidak mencatat jenis protokol, jadi pastikan port
benar-benar SOCKS5 — kalau ragu pakai `--scheme http`/`--scheme socks5` untuk
memaksa. Hanya status `Live` yang diambil, maksimal satu node per negara;
import offline, tidak menguji atau mengklaim endpoint masih hidup. Env
`NODES`/`nodes.json` tetap mendukung HTTP CONNECT dan SOCKS5 dengan
autentikasi user/password.

Cek node sebelum deploy (handshake beneran + exit IP & negara lewat tunnel):

```bash
node scripts/probe-nodes.js nodes.example.json --write nodes.verified.json
# atau: npm run probe -- nodes.example.json --write nodes.verified.json
```

Probe menjalankan SOCKS5/HTTP CONNECT sungguhan, lalu (kalau bisa) meminta
`ip-api.com` lewat tunnel untuk membaca **exit IP + negara asli**. Node yang
exit-nya beda negara dari flag-nya ditandai `<-- expected XX`; `--write` hanya
menulis node yang hidup dan region-nya cocok (atau tak terbaca) ke file hasil.
Hasil scan bukan jaminan — jalankan ulang sebelum dipakai karena proxy hasil
scan orang lain sering mati/berganti.

Catatan jujur:

- Proxy harus milikmu (VPS $3/negara atau provider residential/datacenter berbayar).
  Daftar proxy hasil scan milik orang lain bukan opsi: trafikmu bisa dibaca operatornya
  dan memakainya adalah akses tanpa izin.
- UDP belum didukung lewat node proxy (VLESS UDP akan ditolak).
- Satu node = satu jalur; kualitasnya sebaik proxy-nya (latensi, uptime).

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
