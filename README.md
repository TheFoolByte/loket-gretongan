# Loket Gretongan

Gateway berbasis satu Docker image untuk **Railway, Render, atau VPS**. Fitur mencakup panel admin, generator akun SSH-over-WebSocket, VLESS, Trojan, dan VMess melalui WebSocket. Render dan Railway memakai jalur HTTP/WebSocket yang sama; VPS dapat membuka port TCP tambahan bila memang dibutuhkan.

File `/data/nodes.json` dan variabel `NODES` milik operator mengalahkan fallback `nodes.verified.json` yang dipertahankan demi kompatibilitas. Tinjau sumber node sebelum dipakai; set `NODES=[]` untuk memaksa mode direct-only. File data persisten disimpan di `/data` pada semua platform.

> Wildcard adalah pemetaan nama host ke service, bukan protokol atau port baru. Untuk node `sg`, `WILDCARD_DOMAIN=loket.example.com` menghasilkan host `sg.loket.example.com`.

## Port dan kemampuan platform

| Target | HTTPS/WebSocket | Raw SSH/TCP | Penyimpanan |
|---|---|---|---|
| Railway | Ya, lewat domain publik dan `PORT` | Opsional: buat TCP Proxy ke port container 22; gunakan hostname dan port publik yang Railway berikan | Pasang Volume di `/data` |
| Render Web Service | Ya, lewat satu port publik `PORT`; SSH-WS bisa lewat `/ssh-ws` | Tidak tersedia untuk raw TCP/SSH atau SSH-SNI publik | Pasang Persistent Disk di `/data` |
| VPS | Ya, sebaiknya di belakang reverse proxy HTTPS | Opsional, petakan port 22 dan 2443 sesuai kebutuhan/firewall | Docker volume atau bind mount di `/data` |

Container yang sama membawa Dropbear, Node gateway, dan Xray. `EXPOSE` hanya metadata Docker: sebuah platform tetap harus mendukung dan secara eksplisit mempublikasikan raw TCP agar SSH/SNI bisa diakses dari internet. Image saat ini menargetkan Linux `amd64` karena binary Xray dan cloudflared yang dipin.

## Variabel konfigurasi

| Variabel | Kegunaan |
|---|---|
| `ADMIN_PASS` | Wajib; password admin minimal 12 karakter. |
| `SESSION_SECRET` | Tetapkan nilai acak yang kuat dan stabil agar sesi tetap konsisten setelah restart. |
| `PORT` / `WEB_PORT` | Port HTTP/WebSocket. Gunakan `PORT` yang disediakan platform; `WEB_PORT` hanya untuk override eksplisit. Aplikasi bind ke `0.0.0.0`. |
| `DATA_DIR` | Direktori state; default `/data`. Volume menyimpan akun, host key SSH, log, dan `nodes.json`. |
| `PUBLIC_HOST` | Host dasar yang dipakai profil saat wildcard tidak tersedia atau untuk koneksi direct. |
| `WILDCARD_DOMAIN` | Domain dasar tanpa skema/path, misalnya `loket.example.com` (tidak perlu menulis `*.`). |
| `VMESS_ENABLED` | Aktifkan pilihan/profil VMess. Docker image mengaktifkannya; di luar Docker default-nya mati kecuali Xray disediakan. |
| `SSH_PUBLIC_HOST` / `SSH_PUBLIC_PORT` | Host dan port dari raw TCP proxy publik. Kosongkan di Render; SSH-WS tetap tersedia lewat WebSocket. |
| `SSH_PORT` | Port Dropbear di dalam container; default `22`. |
| `TRUST_PROXY` | Default `1` untuk ingress di balik proxy platform. Pada VPS yang menerima koneksi langsung tanpa reverse proxy tepercaya, set `0` agar header `X-Forwarded-For` dari klien diabaikan. |
| `COOKIE_SECURE` | Default `1`; gunakan HTTPS pada domain publik. Untuk pengembangan lokal HTTP saja, set `0`. |
| `NODES` / `NODES_FILE` | Urutan sumber: file `/data/nodes.json`, `NODES` env, lalu fallback `nodes.verified.json`; `NODES=[]` secara eksplisit mengalahkan semuanya untuk direct-only. Maksimal 256 node. |
| `SIGNUP_PER_IP`, `SIGNUP_DAILY`, `SIGNUP_MAX_DAYS`, `SIGNUP_BURST` | Batas signup. Generator tidak meminta masa aktif; server menetapkannya sendiri sesuai kebijakan runtime (default maksimum publik 7 hari). |
| `ENABLE_SNI`, `SSH_SSL_PORT` | Opsional; hidupkan listener TLS/SNI raw di port `2443` hanya pada target yang mendukung raw TCP. Default SNI mati. |
| `ENABLE_CLOUDFLARED`, `CF_TUNNEL_TOKEN` | Opsional untuk Cloudflare Tunnel. Tunnel tidak diperlukan untuk HTTP/WebSocket biasa di balik domain yang sudah diarahkan ke service. |

Jangan commit file `.env` atau memasukkan password, token, dan kredensial proxy ke README/repository.

## Deploy ke Railway

Pilih Dockerfile pada root repository. Tambahkan Volume dengan mount path `/data`; volume tersedia saat container berjalan. Tambahkan sekurangnya `ADMIN_PASS` dan `SESSION_SECRET`, lalu isi `PUBLIC_HOST` dan `WILDCARD_DOMAIN` setelah hostname diputuskan. Railway menyediakan port HTTP; aplikasi mengikuti nilai `PORT` tersebut.

Di **Settings → Networking**, tambahkan domain dasar dan wildcard pada service. Railway menampilkan DNS record yang harus dibuat; ikuti nilai persis, termasuk CNAME dan TXT verifikasi. Untuk wildcard, Railway juga menggunakan record `_acme-challenge`; bila Cloudflare dipakai, record ini harus DNS-only agar verifikasi sertifikat berhasil.

Raw SSH adalah pilihan terpisah. Buat **TCP Proxy** yang mengarah ke port internal `22`, lalu gunakan hostname dan port publik yang Railway berikan sebagai `SSH_PUBLIC_HOST` dan `SSH_PUBLIC_PORT`. Kalau memakai hostname sendiri di Cloudflare untuk raw TCP, record harus DNS-only dan klien tetap harus memakai port publik Railway. Jalur HTTP/WebSocket dan TCP dapat hidup bersamaan. Lihat [Railway TCP Proxy](https://docs.railway.com/networking/tcp-proxy), [domain dan wildcard Railway](https://docs.railway.com/networking/domains/working-with-domains), serta [Railway Volumes](https://docs.railway.com/volumes).

## Deploy ke Render

Buat **Web Service** dari repository ini dengan Dockerfile yang ada, lalu pasang **Persistent Disk** di `/data`. Render menyediakan `PORT`; jangan mengunci port publik ke nilai lain. Tambahkan domain dasar dan wildcard ke Web Service, lalu buat record DNS dan verifikasi persis sesuai instruksi Render. TLS diurus oleh Render setelah domain terverifikasi.

Render Web Service menerima HTTPS dan WebSocket pada port publik yang sama. SSH-over-WebSocket berfungsi di `/ssh-ws`, tetapi port 22/2443 di dalam container tidak menjadi raw TCP publik. Untuk SSH di Render, gunakan profil SSH-WS. Lihat [custom domains](https://render.com/docs/custom-domains), [WebSocket](https://render.com/docs/websocket), dan [Web Services](https://render.com/docs/web-services).

## Deploy di VPS dengan Docker

Pasang Docker, clone repository, lalu build image:

```bash
git clone https://github.com/TheFoolByte/loket-gretongan.git
cd loket-gretongan
docker build -t loket-gretongan:local .
```

Buat `.env` lokal (jangan commit) dengan `ADMIN_PASS`, `SESSION_SECRET`, `PUBLIC_HOST`, dan `WILDCARD_DOMAIN`. Jalankan di belakang reverse proxy HTTPS yang meneruskan header klien dengan benar:

```bash
docker run -d --name loket-gretongan --restart unless-stopped \
  --env-file .env \
  -e TRUST_PROXY=1 \
  -p 127.0.0.1:8080:8080 \
  -p 2222:22 \
  -v loket-data:/data \
  loket-gretongan:local
```

Reverse proxy web diarahkan ke `127.0.0.1:8080`. Port SSH publik `2222` adalah opsional; jika dipakai, set `SSH_PUBLIC_HOST` dan `SSH_PUBLIC_PORT=2222` di `.env`, dan izinkan port itu di firewall. Bila memakai listener SNI, set `ENABLE_SNI=1` dan petakan port internal yang dipilih (default `2443`). Tanpa reverse proxy tepercaya, set `TRUST_PROXY=0`; jangan biarkan aplikasi web publik berjalan tanpa HTTPS.

Untuk DNS di Cloudflare, arahkan host dasar dan `*` ke reverse proxy VPS. Wildcard hanya menangani pemetaan hostname; sertifikat wildcard dan terminasi HTTPS harus disiapkan pada reverse proxy atau layanan TLS yang digunakan.

## Hostname dan Cloudflare

Pilih satu subdomain khusus untuk Loket, misalnya `loket.example.com`, agar tidak bertabrakan dengan route Worker atau aplikasi lain di domain utama. Set `PUBLIC_HOST=loket.example.com` dan `WILDCARD_DOMAIN=loket.example.com`; hostname node lalu menjadi `sg.loket.example.com`, `jp.loket.example.com`, dan seterusnya. Pastikan record dasar dan `*` diarahkan ke target platform yang benar. Jangan mengubah route Worker yang sudah ada sebelum target dan hostname dipastikan.

Untuk HTTP/WebSocket, Cloudflare dapat dipakai sebagai DNS/proxy sesuai konfigurasi sertifikat dan platform. Raw TCP berbeda: Cloudflare DNS biasa tidak mem-proxy port TCP arbitrer, sehingga hostname untuk Railway TCP Proxy harus DNS-only. Wildcard DNS sendiri tidak menambah dukungan transport. Lihat [Cloudflare wildcard DNS](https://developers.cloudflare.com/dns/manage-dns-records/reference/wildcard-dns-records/).

## Panel admin dan protokol

| Path | Akses | Fungsi |
|---|---|---|
| `/` | Publik | Ringkasan service dan protokol yang aktif. |
| `/vpn` | Publik | Generator akun; memilih protokol/node lalu membuat akun dan menampilkan profil/QR. Tidak ada pemilih masa aktif di UI. |
| `/admin` | Admin (`ADMIN_PASS`) | Live bandwidth, total trafik per protokol, akun/IP, blokir akun/IP, kesehatan node, scan/import, dan Pull & Merge. |
| `/health` | Platform/internal | Health check container. |

Live bandwidth merupakan sampel selisih byte payload relay tiap 2 detik; counter total reset saat proses restart. VLESS/Trojan memiliki byte usage per akun. SSH menampilkan login yang dapat diatribusikan dari log autentikasi. VMess dicatat agregat karena Xray menangani autentikasi di proses tersendiri; statistik byte per-user VMess belum tersedia.

Protokol publik berjalan melalui TLS + WebSocket: SSH-WS di `/ssh-ws`, VLESS di `/vless-ws`, Trojan di `/trojan-ws`, dan VMess di `/vmess-ws`. Xray-core v26.3.27 dipin serta checksum-nya diverifikasi di Dockerfile; daftar user VMess disinkronkan secara dinamis. Dokumentasi Xray menandai VMess dan WebSocket transport sebagai deprecated; VLESS lebih disarankan untuk penggunaan baru, tetapi VMess dipertahankan demi kompatibilitas klien. UDP tidak diteruskan lewat node egress.

Signup publik dibatasi oleh `SIGNUP_PER_IP`, `SIGNUP_DAILY`, `SIGNUP_MAX_DAYS`, dan `SIGNUP_BURST`. Password akun disimpan sebagai hash; password/profil lengkap hanya dikembalikan sekali ketika akun dibuat. Endpoint demo `/api/config` dinonaktifkan dan pemindai port publik tidak tersedia.

## Node egress

Urutan pemuatan adalah file `/data/nodes.json`, variabel `NODES`, lalu fallback repository `nodes.verified.json` untuk menjaga instalasi lama tetap berfungsi. File/env operator menang atas fallback. `NODES=[]` secara eksplisit mengalahkan file volume maupun fallback untuk direct-only. Tinjau daftar bawaan dan gunakan hanya endpoint proxy yang dipercaya atau memang diizinkan. Contoh:

```json
[
  {"id":"sg","name":"Singapore","flag":"SG","proxy":"socks5://user:pass@proxy.example:1080"},
  {"id":"jp","name":"Japan","flag":"JP","proxy":"http://user:pass@proxy.example:8080"}
]
```

Import laporan secara offline dengan `node scripts/import-nodes.js result_proxy.txt nodes.json --regions SG,JP,US`, lalu letakkan hasil sebagai `/data/nodes.json`. Untuk menguji endpoint yang memang berhak kamu uji, gunakan `node scripts/probe-nodes.js nodes.json --write nodes.verified.json`. Probe koneksi bukan jaminan uptime. Operator proxy dapat melihat trafik; jangan memasukkan node dari hasil scan publik yang kepemilikan/izinnya tidak jelas.

## Keamanan dan pengembangan

Container menolak boot tanpa password admin minimal 12 karakter. Panel memakai session cookie bertanda tangan dan CSRF; proses web berjalan sebagai user non-root dan aksi akun OS dibatasi ke helper `loket-user`. Egress memblokir alamat privat, loopback, link-local, serta metadata. Jangan aktifkan `ALLOW_PRIVATE_TARGETS=1` pada service publik. Set `TRUST_PROXY=0` bila ingress langsung ke VPS; jika `1`, pasang hanya di belakang reverse proxy yang mengganti/membersihkan header forwarded.

Untuk pengembangan lokal:

```bash
npm ci
npm run check
npm test
PORT=8080 ADMIN_PASS=dev-password-123 DATA_DIR=./data \
  LOKET_NO_HELPER=1 COOKIE_SECURE=0 TRUST_PROXY=0 VMESS_ENABLED=0 npm start
```

## Berkas utama

| Berkas | Tanggung jawab |
|---|---|
| `Dockerfile`, `entrypoint.sh` | Image lintas platform, service, dan port. |
| `src/server.js`, `src/ui.js` | HTTP/API, host routing, generator, Dashboard, Admin. |
| `src/vless.js`, `src/vmess-ws.js`, `src/xray-vmess.js` | Relay VLESS/Trojan, bridge VMess, dan sinkronisasi Xray. |
| `src/wildcard.js`, `src/nodes.js` | Validasi hostname dan pemetaan node egress. |
| `src/usage.js`, `src/ssh-log.js` | Statistik akun, IP, dan login SSH. |
| `src/net-guard.js`, `src/ssh-ws.js` | Perlindungan egress dan SSH-over-WebSocket. |

Pembaruan ini hanya menyiapkan kode/dokumentasi di branch kerja. Tidak ada perubahan DNS/Worker Cloudflare, service Render, atau deployment yang dilakukan.
