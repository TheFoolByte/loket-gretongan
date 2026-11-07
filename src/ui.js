/**
 * Server-rendered pages: public config generator and the admin monitor.
 * Premium macOS / glassmorphism inspired dashboard (argo-node reference)
 * with region selection, bug SNI/wildcard chips, and QR code support.
 */
'use strict';

const QR = require('qrcode');

const CSS = `
:root{
  --bg:#07080A;
  --card:rgba(8,10,14,0.32);
  --line:rgba(255,255,255,0.09);
  --line-strong:rgba(255,255,255,0.18);
  --fg:#F2F2F2;
  --muted:#8E99A8;
  --acc:#1b6ef3;
  --acc-glow:rgba(27,110,243,0.35);
  --cyan:#7dd3e0;
  --cyan-glow:rgba(125,211,224,0.3);
  --ok:#22c55e;
  --bad:#ef4444;
}
*{box-sizing:border-box;margin:0;padding:0}
html{-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;scroll-behavior:smooth}
body{
  margin:0;
  font:13.5px/1.55 -apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter", "Helvetica Neue", Helvetica, Arial, sans-serif;
  background:var(--bg);
  color:var(--fg);
  min-height:100vh;
  display:flex;
  flex-direction:column;
  align-items:center;
  padding:40px 18px 60px;
  overflow-x:hidden;
  perspective:1200px;
  position:relative;
}
.bg-image{
  position:fixed;
  inset:0;
  z-index:-2;
  background:radial-gradient(1200px 700px at 50% -10%, #152238 0%, #0a0e14 60%, #050608 100%);
  filter:brightness(0.95);
  pointer-events:none;
}
.bg-orbs{position:fixed;inset:0;pointer-events:none;overflow:hidden;z-index:-1;opacity:0.25}
.orb{position:absolute;border-radius:50%;filter:blur(80px);will-change:transform}
.orb1{width:520px;height:520px;left:-100px;top:-60px;background:radial-gradient(circle, rgba(27,110,243,0.25) 0%, transparent 70%);animation:floatA 20s ease-in-out infinite}
.orb2{width:560px;height:560px;right:-120px;bottom:-100px;background:radial-gradient(circle, rgba(125,211,224,0.18) 0%, transparent 70%);animation:floatB 24s ease-in-out infinite}
@keyframes floatA{0%,100%{transform:translate3d(0,0,0) scale(1)}50%{transform:translate3d(20px,24px,0) scale(1.05)}}
@keyframes floatB{0%,100%{transform:translate3d(0,0,0) scale(1)}50%{transform:translate3d(-18px,-20px,0) scale(1.03)}}

.shell{
  width:100%;
  max-width:640px;
  position:relative;
  z-index:1;
  transform-style:preserve-3d;
  will-change:transform;
}
.panel{
  background:var(--card);
  backdrop-filter:blur(20px);
  -webkit-backdrop-filter:blur(20px);
  border:1px solid var(--line);
  border-radius:22px;
  overflow:hidden;
  box-shadow:0 20px 60px rgba(0,0,0,0.65), 0 1px 0 rgba(255,255,255,0.08) inset;
  transition:box-shadow 0.4s ease, border-color 0.4s ease;
}
.panel:hover{
  border-color:var(--line-strong);
  box-shadow:0 24px 70px rgba(0,0,0,0.75), 0 1px 0 rgba(255,255,255,0.12) inset;
}
.header{
  height:60px;
  display:flex;
  align-items:center;
  justify-content:space-between;
  padding:0 24px;
  border-bottom:1px solid var(--line);
  background:rgba(8,10,14,0.4);
}
.brand{
  font-size:12px;
  font-weight:700;
  letter-spacing:0.24em;
  text-transform:uppercase;
  color:#FFFFFF;
  display:flex;
  align-items:center;
  gap:8px;
}
.brand .dot{
  width:8px;
  height:8px;
  border-radius:50%;
  background:var(--ok);
  box-shadow:0 0 10px var(--ok);
}
.nav-link{
  font-size:12px;
  color:var(--muted);
  text-decoration:none;
  padding:5px 11px;
  border-radius:8px;
  border:1px solid transparent;
  transition:all 0.2s;
}
.nav-link:hover{
  color:#fff;
  border-color:var(--line);
  background:rgba(255,255,255,0.05);
}
.content{padding:24px 24px 20px}

.eyebrow{
  font-size:11px;
  font-weight:700;
  letter-spacing:0.12em;
  text-transform:uppercase;
  color:var(--muted);
  margin-bottom:10px;
  display:flex;
  align-items:center;
  gap:8px;
}
.eyebrow .line{
  flex:1;
  height:1px;
  background:linear-gradient(90deg, var(--line) 0%, transparent 100%);
}
.group{
  margin-bottom:16px;
  background:rgba(8,10,14,0.3);
  border:1px solid var(--line);
  border-radius:14px;
  padding:14px;
  box-shadow:inset 0 1px 0 rgba(255,255,255,0.04);
  transition:border-color 0.25s, background 0.25s;
}
.group:hover{
  border-color:rgba(255,255,255,0.15);
  background:rgba(8,10,14,0.45);
}

label{display:block;font-size:11.5px;color:var(--muted);margin:0 0 6px;font-weight:500}
input,select{
  font:inherit;
  color:var(--fg);
  background:rgba(12,16,22,0.6);
  border:1px solid var(--line);
  border-radius:10px;
  padding:10px 12px;
  width:100%;
  outline:none;
  transition:border-color 0.2s, box-shadow 0.2s;
}
input:focus,select:focus{
  border-color:var(--cyan);
  box-shadow:0 0 0 3px var(--cyan-glow);
}

.row{display:flex;gap:10px;flex-wrap:wrap}
.row>*{flex:1}
.grid-2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.grid-3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}

button.proto{
  height:44px;
  background:rgba(8,10,14,0.35);
  border:1px solid var(--line);
  border-radius:11px;
  color:#E8E8E8;
  font-size:12.5px;
  font-weight:600;
  letter-spacing:0.04em;
  cursor:pointer;
  transition:all 0.2s cubic-bezier(0.23,1,0.32,1);
  box-shadow:inset 0 1px 0 rgba(255,255,255,0.05), 0 2px 8px rgba(0,0,0,0.25);
  display:flex;
  align-items:center;
  justify-content:center;
  gap:6px;
}
button.proto:hover{
  background:rgba(255,255,255,0.08);
  border-color:rgba(255,255,255,0.2);
  color:#FFFFFF;
  transform:translateY(-1px);
}
button.proto.active{
  background:#FFFFFF;
  border-color:#FFFFFF;
  color:#0A0A0A;
  font-weight:700;
  box-shadow:0 4px 18px rgba(255,255,255,0.25);
}

button.btn-primary{
  width:100%;
  height:46px;
  background:linear-gradient(180deg, #2b7af7 0%, #175cd3 100%);
  border:1px solid rgba(255,255,255,0.2);
  border-radius:11px;
  color:#FFFFFF;
  font-size:13.5px;
  font-weight:650;
  letter-spacing:0.03em;
  cursor:pointer;
  transition:all 0.2s;
  box-shadow:0 6px 20px var(--acc-glow), inset 0 1px 0 rgba(255,255,255,0.25);
}
button.btn-primary:hover{
  filter:brightness(1.08);
  transform:translateY(-1px);
}
button.btn-primary:active{transform:scale(0.99)}

.wildcard-list{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
.chip{
  display:inline-flex;
  align-items:center;
  padding:6px 11px;
  background:rgba(8,10,14,0.4);
  border:1px solid var(--line);
  border-radius:999px;
  font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size:11.5px;
  color:#E0E0E0;
  cursor:pointer;
  transition:all 0.2s;
}
.chip:hover{
  border-color:var(--cyan);
  color:#fff;
  background:rgba(125,211,224,0.1);
  transform:translateY(-1px);
}
.chip.active{
  border-color:var(--cyan);
  color:var(--cyan);
  background:rgba(125,211,224,0.15);
  box-shadow:0 0 12px var(--cyan-glow);
}

.cfg-card{
  margin-top:14px;
  padding:14px;
  border:1px dashed var(--line-strong);
  border-radius:12px;
  background:rgba(0,0,0,0.3);
}
.cfg-row{
  display:flex;
  gap:10px;
  align-items:center;
  justify-content:space-between;
  margin-top:10px;
}
.cfg-row:first-child{margin-top:0}
.cfg-val{flex:1;min-width:0}
.cfg-val code{
  display:block;
  background:rgba(0,0,0,0.5);
  border:1px solid var(--line);
  padding:8px 10px;
  border-radius:8px;
  font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size:11px;
  color:#E8E8E8;
  word-break:break-all;
  max-height:80px;
  overflow-y:auto;
}
.qr-box{
  background:#fff;
  padding:6px;
  border-radius:8px;
  width:100px;
  height:100px;
  flex-shrink:0;
  display:flex;
  align-items:center;
  justify-content:center;
}
.qr-box svg{width:100%;height:100%}

button.btn-copy{
  padding:7px 14px;
  background:rgba(255,255,255,0.92);
  color:#0A0A0A;
  border:none;
  border-radius:8px;
  font-size:12px;
  font-weight:650;
  cursor:pointer;
  transition:all 0.15s;
}
button.btn-copy:hover{background:#FFFFFF;transform:translateY(-1px)}
button.btn-copy.copied{background:var(--ok);color:#04140a}

.msg{margin-top:10px;font-size:12px;text-align:center}
.msg.err{color:var(--bad)}
.msg.ok{color:var(--ok)}
.msg.loading{color:var(--cyan)}

.footer{
  margin-top:18px;
  text-align:center;
  font-size:11.5px;
  color:var(--muted);
}
.footer a{color:var(--muted);text-decoration:none}
.footer a:hover{color:#fff}

/* Admin specific */
table{width:100%;border-collapse:collapse;font-size:12.5px;margin-top:8px}
th,td{text-align:left;padding:8px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--muted);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.4px}
.badge{display:inline-block;font-size:10.5px;padding:2px 7px;border-radius:99px;border:1px solid var(--line);color:var(--muted)}
.badge.ok{color:var(--ok);border-color:#14532d;background:rgba(34,197,94,0.08)}
.badge.bad{color:var(--bad);border-color:#7f1d1d;background:rgba(239,68,68,0.08)}
button.small{padding:5px 9px;font-size:11.5px;width:auto;border-radius:7px;cursor:pointer}
button.ghost{background:transparent;border:1px solid var(--line);color:var(--fg)}
button.ghost:hover{border-color:rgba(255,255,255,0.3);color:#fff}
button.danger{background:var(--bad);border:1px solid var(--bad);color:#fff}

@media(max-width:600px){
  body{padding:20px 12px 40px}
  .content{padding:18px 16px}
  .header{padding:0 16px}
  .grid-2,.grid-3{grid-template-columns:1fr}
  .cfg-row{flex-direction:column;align-items:stretch}
  .qr-box{margin:8px auto 0}
}
`;

const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const BUILTIN_WILDCARDS = [
  'support.zoom.us',
  'ava.game.naver.com',
  'quiz.vidio.com',
  'graph.instagram.com',
  'api.midtrans.com',
  'investor.spotify.com',
];

// ------------------------------------------------------------------ public

function publicPage({ host, sshHost, sshPort, limits, nodes = [] }) {
  const nodesJson = JSON.stringify(nodes);
  const hostJson = JSON.stringify(host || 'localhost');

  const body = `
  <div class="bg-image" aria-hidden="true"></div>
  <div class="bg-orbs" aria-hidden="true"><div class="orb orb1"></div><div class="orb orb2"></div></div>

  <div class="shell" id="shell">
    <div class="panel">
      <div class="header">
        <div class="brand"><span class="dot"></span> LOKET GRETONGAN</div>
        <a href="/admin" class="nav-link">Admin →</a>
      </div>

      <div class="content">
        <!-- Region / Node Selection -->
        <div class="group">
          <div class="eyebrow"><span>Pilih Region Keluar</span><span class="line"></span></div>
          <select id="sel-node">
            <option value="">⚡ Direct (Railway SG / Asli Server)</option>
            ${nodes.map((n) => `<option value="${esc(n.id)}">${esc(n.flag || '🌐')} ${esc(n.name)} (${esc(n.id.toUpperCase())})</option>`).join('')}
          </select>
        </div>

        <!-- Bug SNI / Wildcard Chips -->
        <div class="group">
          <div class="eyebrow"><span>Bug SNI / Wildcard CDN</span><span class="line"></span></div>
          <input id="inp-sni" placeholder="Custom SNI / bug domain (default: host server)" autocomplete="off">
          <div class="wildcard-list" id="chips">
            ${BUILTIN_WILDCARDS.map((w) => `<span class="chip" onclick="pickSni(this,'${esc(w)}')">${esc(w)}</span>`).join('')}
          </div>
        </div>

        <!-- Akun params (optional) -->
        <div class="group">
          <div class="eyebrow"><span>Pengaturan Akun</span><span class="line"></span></div>
          <div class="row">
            <div style="flex:2">
              <label>Username (opsional)</label>
              <input id="u" placeholder="acak otomatis" autocomplete="off">
            </div>
            <div style="flex:1">
              <label>Masa aktif (hari)</label>
              <input id="d" value="1" inputmode="numeric" max="${limits.perIp || 7}">
            </div>
          </div>
        </div>

        <!-- Generate Button -->
        <button class="btn-primary" id="btn-gen" onclick="generateAccount()">⚡ Generate Config Lengkap</button>
        <div class="msg" id="msg"></div>

        <!-- Results Display -->
        <div id="result" style="display:none">
          <div class="cfg-card">
            <div class="eyebrow" id="res-title"><span>Config Siap Pakai</span><span class="line"></span></div>

            <!-- VLESS -->
            <div class="cfg-row">
              <div class="cfg-val">
                <label>VLESS WS (TLS)</label>
                <code id="out-vless">-</code>
              </div>
              <div style="display:flex;gap:6px;align-items:center;flex-shrink:0">
                <button class="btn-copy" onclick="copyText('out-vless',this)">Copy</button>
                <div class="qr-box" id="qr-vless"></div>
              </div>
            </div>

            <!-- Trojan -->
            <div class="cfg-row" style="margin-top:14px">
              <div class="cfg-val">
                <label>TROJAN WS (TLS)</label>
                <code id="out-trojan">-</code>
              </div>
              <div style="display:flex;gap:6px;align-items:center;flex-shrink:0">
                <button class="btn-copy" onclick="copyText('out-trojan',this)">Copy</button>
                <div class="qr-box" id="qr-trojan"></div>
              </div>
            </div>

            <!-- SSH Direct + WS -->
            <div class="cfg-row" style="margin-top:14px">
              <div class="cfg-val">
                <label>SSH Direct</label>
                <code id="out-ssh">-</code>
              </div>
              <button class="btn-copy" onclick="copyText('out-ssh',this)">Copy</button>
            </div>
            <div class="cfg-row" style="margin-top:10px">
              <div class="cfg-val">
                <label>SSH-WS (HTTP Custom / Injector)</label>
                <code id="out-ssh-ws">-</code>
              </div>
              <button class="btn-copy" onclick="copyText('out-ssh-ws',this)">Copy</button>
            </div>
          </div>
        </div>

        <div class="footer">
          Batas: ${limits.perIp} akun / 24 jam per IP · Host: <code>${esc(host || 'localhost')}</code>
        </div>
      </div>
    </div>
  </div>`;

  const script = `
  const defaultHost = ${hostJson};
  const nodes = ${nodesJson};
  let currentAccount = null;
  let currentQr = null;

  // 3D tilt lerp
  (function(){
    const shell = document.getElementById('shell');
    if (!shell) return;
    let tx=0, ty=0, cx=0, cy=0, running=false;
    function loop(){
      cx += (tx-cx)*0.07;
      cy += (ty-cy)*0.07;
      shell.style.transform = 'rotateY(' + cx.toFixed(3) + 'deg) rotateX(' + cy.toFixed(3) + 'deg)';
      if (Math.abs(tx-cx) > 0.002 || Math.abs(ty-cy) > 0.002) {
        requestAnimationFrame(loop);
      } else { running = false; }
    }
    window.addEventListener('mousemove', (e) => {
      if (window.matchMedia('(pointer: coarse)').matches) return;
      tx = (e.clientX/window.innerWidth - 0.5) * 3.0;
      ty = -(e.clientY/window.innerHeight - 0.5) * 2.5;
      if (!running) { running = true; requestAnimationFrame(loop); }
    }, { passive: true });
  })();

  function pickSni(el, sni) {
    const inp = document.getElementById('inp-sni');
    if (el.classList.contains('active')) {
      el.classList.remove('active');
      inp.value = '';
    } else {
      document.querySelectorAll('#chips .chip').forEach(c => c.classList.remove('active'));
      el.classList.add('active');
      inp.value = sni;
    }
    if (currentAccount) refreshDisplay();
  }

  function copyText(elemId, btn) {
    const el = document.getElementById(elemId);
    if (!el) return;
    const text = el.textContent;
    navigator.clipboard.writeText(text).then(() => {
      const old = btn.textContent;
      btn.textContent = 'Copied ✓';
      btn.classList.add('copied');
      setTimeout(() => { btn.textContent = old; btn.classList.remove('copied'); }, 1400);
    });
  }

  function applySniToLink(link, sni) {
    if (!sni || !sni.trim()) return link;
    const clean = sni.trim();
    try {
      const u = new URL(link);
      u.searchParams.set('sni', clean);
      u.searchParams.set('host', clean);
      return u.toString();
    } catch {
      return link;
    }
  }

  function refreshDisplay() {
    if (!currentAccount) return;
    const sni = document.getElementById('inp-sni').value.trim();
    const vless = applySniToLink(currentAccount.vless, sni);
    const trojan = applySniToLink(currentAccount.trojan, sni);

    document.getElementById('out-vless').textContent = vless;
    document.getElementById('out-trojan').textContent = trojan;
    document.getElementById('out-ssh').textContent = currentAccount.sshCommand;
    document.getElementById('out-ssh-ws').textContent = currentAccount.sshWs;
  }

  async function generateAccount() {
    const btn = document.getElementById('btn-gen');
    const msg = document.getElementById('msg');
    const resBox = document.getElementById('result');
    const username = document.getElementById('u').value.trim();
    const days = Number(document.getElementById('d').value || 1);
    const node = document.getElementById('sel-node').value;

    btn.disabled = true;
    msg.className = 'msg loading';
    msg.textContent = 'Membuat akun & config…';

    try {
      const res = await fetch('/api/public/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, days, node }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal generate');

      currentAccount = data.account;
      currentQr = data.qr || {};

      document.getElementById('res-title').innerHTML =
        '<span>Config untuk <code>' + currentAccount.username + '</code> (exp: ' + currentAccount.expired + ')</span><span class="line"></span>';
      document.getElementById('qr-vless').innerHTML = currentQr.vless || '';
      document.getElementById('qr-trojan').innerHTML = currentQr.trojan || '';

      refreshDisplay();
      resBox.style.display = 'block';
      msg.className = 'msg ok';
      msg.textContent = 'Akun berhasil dibuat! Simpan config di bawah.';
    } catch (err) {
      msg.className = 'msg err';
      msg.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  }

  // Update on node change
  document.getElementById('sel-node').onchange = () => {
    if (currentAccount) {
      // Prompt user to re-generate because path changes per node
      document.getElementById('msg').className = 'msg';
      document.getElementById('msg').textContent = 'Region berubah — klik Generate ulang untuk mendapatkan config node ini.';
    }
  };
  document.getElementById('inp-sni').oninput = () => {
    if (currentAccount) refreshDisplay();
  };
  `;

  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>LOKET GRETONGAN · VPN Generator</title>
<style>${CSS}</style>
</head>
<body>
${body}
<script>${script}</script>
</body>
</html>`;
}

// ------------------------------------------------------------------- admin

function adminPage({ host }) {
  const body = `
  <div class="bg-image" aria-hidden="true"></div>
  <div class="shell" style="max-width:820px">
    <div class="panel">
      <div class="header">
        <div class="brand"><span class="dot"></span> LOKET · ADMIN MONITOR</div>
        <div style="display:flex;gap:8px">
          <a href="/" class="nav-link">← Public</a>
          <a href="#" id="out" class="nav-link" style="display:none">Keluar</a>
        </div>
      </div>

      <div class="content">
        <div class="group" id="login">
          <div class="eyebrow"><span>Masuk Admin</span><span class="line"></span></div>
          <div class="row">
            <input id="p" type="password" placeholder="ADMIN_PASS">
            <button class="btn-primary" id="loginBtn" style="flex:0 0 120px">Masuk</button>
          </div>
          <div class="msg" id="lmsg"></div>
        </div>

        <div id="dash" style="display:none">
          <div class="group">
            <div class="eyebrow"><span>Daftar User</span><span class="muted" id="ucount"></span><span class="line"></span></div>
            <table>
              <thead><tr><th>User</th><th>IP</th><th>Expired</th><th>Trafik (VL/TJ)</th><th>Status</th><th>Aksi</th></tr></thead>
              <tbody id="users"></tbody>
            </table>
          </div>

          <div class="group">
            <div class="eyebrow"><span>Status Node Keluar (Multi-Region)</span><span class="line"></span></div>
            <table>
              <thead><tr><th>Node</th><th>Proxy Egress</th><th>Status</th><th>Latensi</th></tr></thead>
              <tbody id="nodes"></tbody>
            </table>
          </div>

          <div class="group">
            <div class="eyebrow"><span>Aktivitas IP</span><span class="line"></span></div>
            <table>
              <thead><tr><th>IP Client</th><th>User</th><th>Koneksi</th><th>Terakhir</th><th>Aksi</th></tr></thead>
              <tbody id="ips"></tbody>
            </table>
          </div>
        </div>

        <div class="footer">
          Host: <code>${esc(host || 'localhost')}</code>
        </div>
      </div>
    </div>
  </div>`;

  const script = `
  let csrf = '';
  const $ = (id) => document.getElementById(id);

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
      ...opts,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  }

  $('loginBtn').onclick = async () => {
    try {
      const r = await api('/api/login', { method: 'POST', body: JSON.stringify({ password: $('p').value }) });
      csrf = r.csrf;
      $('login').style.display = 'none';
      $('dash').style.display = 'block';
      $('out').style.display = 'inline-block';
      load();
    } catch (e) { $('lmsg').className = 'msg err'; $('lmsg').textContent = e.message; }
  };
  $('out').onclick = async (e) => { e.preventDefault(); await api('/api/logout', { method: 'POST' }); location.reload(); };

  const fmt = (n) => n > 1048576 ? (n/1048576).toFixed(1)+' MB' : n > 1024 ? (n/1024).toFixed(0)+' KB' : (n||0)+' B';

  async function load() {
    try {
      const d = await api('/api/admin/overview');
      $('ucount').textContent = ' (' + d.users.length + ')';
      $('users').innerHTML = d.users.map(u => '<tr>' +
        '<td><code>' + u.username + '</code></td>' +
        '<td>' + (u.ip || '-') + '</td>' +
        '<td>' + u.expired + '</td>' +
        '<td>' + fmt(u.bytes.vless) + ' / ' + fmt(u.bytes.trojan) + '</td>' +
        '<td>' + (u.active ? '<span class="badge ok">aktif</span>' : '<span class="badge bad">nonaktif</span>') + '</td>' +
        '<td style="white-space:nowrap">' +
          (u.ip ? '<button class="small ghost" onclick="toggleIp(\\'' + u.ip + '\\', true)">blok ip</button> ' : '') +
          '<button class="small danger" onclick="del(\\'' + u.username + '\\')">hapus</button>' +
        '</td></tr>').join('') || '<tr><td colspan="6" class="muted">belum ada user</td></tr>';

      try {
        const nd = await api('/api/admin/nodes');
        $('nodes').innerHTML = nd.nodes.map(n => '<tr>' +
          '<td>' + (n.flag || '') + ' <code>' + n.id + '</code> ' + n.name + '</td>' +
          '<td>' + (n.proxy ? '<span class="badge">proxy</span>' : '<span class="badge">direct</span>') + '</td>' +
          '<td>' + (n.ok ? '<span class="badge ok">ok</span>' : '<span class="badge bad">' + n.note + '</span>') + '</td>' +
          '<td>' + n.ms + ' ms</td></tr>').join('') || '<tr><td colspan="4" class="muted">belum ada node</td></tr>';
      } catch (e) {}

      $('ips').innerHTML = d.ips.map(i => '<tr>' +
        '<td><code>' + i.ip + '</code> ' + (i.blocked ? '<span class="badge bad">blok</span>' : '') + '</td>' +
        '<td>' + ((i.users||[]).join(', ') || '-') + '</td>' +
        '<td>' + i.conns + '</td>' +
        '<td>' + (i.lastSeen ? new Date(i.lastSeen).toLocaleString() : '-') + '</td>' +
        '<td><button class="small ghost" onclick="toggleIp(\\'' + i.ip + '\\', ' + (i.blocked ? 'false' : 'true') + ')">' + (i.blocked ? 'buka' : 'blok') + '</button></td>' +
      '</tr>').join('') || '<tr><td colspan="5" class="muted">belum ada aktivitas</td></tr>';
    } catch (e) {
      console.error(e);
    }
  }

  window.toggleIp = async (ip, block) => { await api('/api/admin/block', { method: 'POST', body: JSON.stringify({ type: 'ip', value: ip, block }) }); load(); };
  window.del = async (username) => {
    if (!confirm('Hapus ' + username + '?')) return;
    await api('/api/admin/users?username=' + encodeURIComponent(username), { method: 'DELETE' }); load();
  };

  api('/api/me').then(() => {
    $('login').style.display = 'none';
    $('dash').style.display = 'block';
    $('out').style.display = 'inline-block';
    load();
  }).catch(() => {});
  `;

  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>LOKET GRETONGAN · Admin</title>
<style>${CSS}</style>
</head>
<body>
${body}
<script>${script}</script>
</body>
</html>`;
}

module.exports = {
  publicPage,
  adminPage,
  qrSvg: (text) => QR.toString(text, { type: 'svg', margin: 0, width: 100 }),
};
