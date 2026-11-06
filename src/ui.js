/**
 * Server-rendered pages: public config generator and the admin monitor.
 * Both are single documents; no build step, no client framework.
 */
'use strict';

const QR = require('qrcode');

const CSS = `
:root{color-scheme:dark;--bg:#0a0e14;--card:#111823;--line:#1e2836;--fg:#d7e0ea;--muted:#7c8b9d;--acc:#1b6ef3;--ok:#22c55e;--bad:#ef4444}
*{box-sizing:border-box}
body{margin:0;font:14px/1.55 ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif;background:radial-gradient(1200px 600px at 50% -10%,#132033,#0a0e14);color:var(--fg)}
main{max-width:900px;margin:0 auto;padding:28px 18px 60px}
h1{font-size:22px;margin:0 0 6px;letter-spacing:.3px}
h2{font-size:15px;margin:0 0 12px}
p.muted,span.muted{color:var(--muted)}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px;margin:16px 0}
label{display:block;font-size:12px;color:var(--muted);margin:0 0 6px}
input,button,select{font:inherit;color:var(--fg);background:#0d141d;border:1px solid #263241;border-radius:10px;padding:11px 13px;width:100%}
button{background:var(--acc);border-color:var(--acc);cursor:pointer;font-weight:600}
button.ghost{background:transparent;border-color:#263241;font-weight:500}
button.small{padding:6px 10px;font-size:12px;width:auto;border-radius:8px}
button.danger{background:var(--bad);border-color:var(--bad)}
button.ok{background:var(--ok);border-color:var(--ok);color:#04140a}
.row{display:flex;gap:10px;flex-wrap:wrap}
.row>*{flex:1}
.grid{display:grid;gap:14px}
@media(min-width:720px){.grid.two{grid-template-columns:1fr 1fr}}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{text-align:left;padding:9px 8px;border-bottom:1px solid #1a2431;vertical-align:top}
th{color:var(--muted);font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.4px}
code{background:#0b1219;border:1px solid #1b2531;padding:3px 7px;border-radius:7px;font-size:12px;word-break:break-all}
.cfg{display:flex;gap:10px;align-items:center;justify-content:space-between;margin:10px 0 0;padding:10px;border:1px dashed #24303f;border-radius:10px}
.cfg .v{flex:1;min-width:0}
.qr{background:#fff;padding:6px;border-radius:8px;width:132px;height:132px}
.badge{display:inline-block;font-size:11px;padding:2px 8px;border-radius:99px;border:1px solid #263241;color:var(--muted)}
.badge.ok{color:var(--ok);border-color:#14532d}
.badge.bad{color:var(--bad);border-color:#7f1d1d}
.msg{margin-top:10px;font-size:13px}
.msg.err{color:var(--bad)}
.msg.ok{color:var(--ok)}
.nav{display:flex;gap:8px;justify-content:flex-end;margin-bottom:6px}
.nav a{color:var(--muted);text-decoration:none;font-size:13px}
`;

const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const shell = ({ title, body, script = '' }) => `<!doctype html>
<html lang="id"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>${CSS}</style></head>
<body><main>${body}</main>${script ? `<script>${script}</script>` : ''}</body></html>`;

const copyJs = `
function copy(el){
  const t = el.dataset.copy || '';
  navigator.clipboard.writeText(t).then(()=>{
    const old = el.textContent; el.textContent = 'tersalin ✓';
    setTimeout(()=>{ el.textContent = old; }, 1200);
  });
}`;

// ------------------------------------------------------------------ public

function publicPage({ host, sshHost, sshPort, limits, nodes = [] }) {
  const body = `
  <div class="nav"><a href="/admin">admin</a></div>
  <h1>LOKET <span class="muted" style="font-weight:400">· generator config</span></h1>
  <p class="muted">Buat akun sekali klik. Config langsung tampil — simpan saat itu juga.</p>

  <div class="card">
    <h2>Buat akun</h2>
    <div class="row">
      <div style="flex:2">
        <label>username (opsional)</label>
        <input id="u" placeholder="kosongkan untuk acak" autocomplete="off">
      </div>
      <div style="flex:1">
        <label>masa aktif</label>
        <input id="d" value="1" inputmode="numeric">
      </div>
    </div>
    ${nodes.length ? `<div style="margin-top:12px"><label>node keluar</label>
      <select id="n">
        <option value="">langsung (tanpa proxy)</option>
        ${nodes.map((n) => `<option value="${esc(n.id)}">${esc(n.flag)} ${esc(n.name)}</option>`).join('')}
      </select></div>` : ''}
    <div class="row" style="margin-top:14px">
      <button id="go">Generate config</button>
    </div>
    <div class="msg" id="msg"></div>
    <p class="muted" style="font-size:12px;margin:12px 0 0">
      Batas: ${limits.perIp} akun / 24 jam per IP. Aktivitas dicatat (IP, protokol, volume).
    </p>
  </div>

  <div id="out"></div>`;

  const script = `
  ${copyJs}
  const host = ${JSON.stringify(host)};
  const sshHost = ${JSON.stringify(sshHost)};
  const sshPort = ${JSON.stringify(sshPort)};
  const msg = document.getElementById('msg');
  const out = document.getElementById('out');

  function cfgBox(label, value, qr){
    return \`<div class="cfg">
      <div class="v"><label>\${label}</label><code id="c-\${label.replace(/\\W/g,'')}">\${value}</code></div>
      <div style="display:flex;gap:6px;align-items:center">
        <button class="small ghost" data-copy="\${value}" onclick="copy(this)">copy</button>
        \${qr ? qr : ''}
      </div></div>\`;
  }

  document.getElementById('go').onclick = async () => {
    msg.className = 'msg'; msg.textContent = 'membuat…';
    try {
      const res = await fetch('/api/public/signup', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: document.getElementById('u').value, days: Number(document.getElementById('d').value || 1), node: document.getElementById('n') ? document.getElementById('n').value : '' }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'gagal');
      const u = j.account;
      msg.className = 'msg ok'; msg.textContent = 'akun dibuat — simpan config di bawah, halaman ini tidak bisa menampilkannya lagi.';
      out.innerHTML = \`<div class="card">
        <h2>Config untuk <code>\${u.username}</code></h2>
        <p class="muted" style="margin-top:0">expired \${u.expired} · password <code>\${u.password}</code>
          \${u.node ? ' · node ' + u.node.flag + ' ' + u.node.name : ''}</p>
        <div class="grid two">
          <div>
            \${cfgBox('SSH', u.sshCommand, '')}
            \${cfgBox('SSH-WS', u.sshWs, '')}
          </div>
          <div>
            \${cfgBox('VLESS', u.vless, j.qr.vless)}
            \${cfgBox('TROJAN', u.trojan, j.qr.trojan)}
          </div>
        </div>
        <p class="muted" style="font-size:12px;margin-top:14px">Host \${host} · SSH \${sshHost}:\${sshPort}</p>
      </div>\`;
    } catch (err) { msg.className = 'msg err'; msg.textContent = err.message; }
  };`;

  return shell({ title: 'LOKET · generator config', body, script });
}

// ------------------------------------------------------------------- admin

function adminPage({ host }) {
  const body = `
  <div class="nav"><a href="/">public</a> · <a href="#" id="out">keluar</a></div>
  <h1>LOKET <span class="muted" style="font-weight:400">· admin</span></h1>
  <p class="muted">Host <code>${esc(host)}</code></p>

  <div class="card" id="login">
    <h2>Masuk</h2>
    <div class="row"><input id="p" type="password" placeholder="ADMIN_PASS"><button id="loginBtn">Masuk</button></div>
    <div class="msg" id="lmsg"></div>
  </div>

  <div id="dash" style="display:none">
    <div class="card">
      <h2>User <span class="muted" id="ucount"></span></h2>
      <table><thead><tr><th>user</th><th>ip</th><th>expired</th><th>vl/tj</th><th>status</th><th></th></tr></thead>
      <tbody id="users"></tbody></table>
    </div>
    <div class="card">
      <h2>Node keluar</h2>
      <table><thead><tr><th>node</th><th>proxy</th><th>status</th><th>latensi</th></tr></thead>
      <tbody id="nodes"></tbody></table>
    </div>
    <div class="card">
      <h2>IP aktif</h2>
      <table><thead><tr><th>ip</th><th>user</th><th>koneksi</th><th>terakhir</th><th></th></tr></thead>
      <tbody id="ips"></tbody></table>
    </div>
  </div>`;

  const script = `
  const body = document.body;
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
      csrf = r.csrf; $('login').style.display = 'none'; $('dash').style.display = 'block'; load();
    } catch (e) { $('lmsg').className = 'msg err'; $('lmsg').textContent = e.message; }
  };
  $('out').onclick = async (e) => { e.preventDefault(); await api('/api/logout', { method: 'POST' }); location.reload(); };

  const fmt = (n) => n > 1048576 ? (n/1048576).toFixed(1)+' MB' : n > 1024 ? (n/1024).toFixed(0)+' KB' : n+' B';

  async function load() {
    const d = await api('/api/admin/overview');
    $('ucount').textContent = '(' + d.users.length + ')';
    $('users').innerHTML = d.users.map(u => \`<tr>
      <td><code>\${u.username}</code></td>
      <td>\${u.ip || '-'}</td>
      <td>\${u.expired}</td>
      <td>\${fmt(u.bytes.vless)} / \${fmt(u.bytes.trojan)}</td>
      <td>\${u.active ? '<span class="badge ok">aktif</span>' : '<span class="badge bad">nonaktif</span>'}</td>
      <td style="white-space:nowrap">
        \${u.ip ? \`<button class="small ghost" onclick="toggleIp('\${u.ip}', true)">blok ip</button>\` : ''}
        <button class="small danger" onclick="del('\${u.username}')">hapus</button>
      </td></tr>\`).join('') || '<tr><td colspan="6" class="muted">belum ada user</td></tr>';

    try {
      const nd = await api('/api/admin/nodes');
      $('nodes').innerHTML = nd.nodes.map(n => \`<tr>
        <td>\${n.flag || ''} <code>\${n.id}</code> \${n.name}</td>
        <td>\${n.proxy ? '<span class="badge">proxy</span>' : '<span class="badge">direct</span>'}</td>
        <td>\${n.ok ? '<span class="badge ok">ok</span>' : \`<span class="badge bad">\${n.note}</span>\`}</td>
        <td>\${n.ms} ms</td></tr>\`).join('') || '<tr><td colspan="4" class="muted">belum ada node (env NODES kosong)</td></tr>';
    } catch (e) { /* nodes endpoint optional */ }

    $('ips').innerHTML = d.ips.map(i => \`<tr>
      <td><code>\${i.ip}</code> \${i.blocked ? '<span class="badge bad">blok</span>' : ''}</td>
      <td>\${(i.users||[]).join(', ') || '-'}</td>
      <td>\${i.conns}</td>
      <td>\${i.lastSeen ? new Date(i.lastSeen).toLocaleString() : '-'}</td>
      <td><button class="small ghost" onclick="toggleIp('\${i.ip}', \${i.blocked ? 'false' : 'true'})">\${i.blocked ? 'buka' : 'blok'}</button></td>
    </tr>\`).join('') || '<tr><td colspan="5" class="muted">belum ada aktivitas</td></tr>';
  }

  window.toggleIp = async (ip, block) => { await api('/api/admin/block', { method: 'POST', body: JSON.stringify({ type: 'ip', value: ip, block }) }); load(); };
  window.del = async (username) => {
    if (!confirm('Hapus ' + username + '?')) return;
    await api('/api/admin/users?username=' + encodeURIComponent(username), { method: 'DELETE' }); load();
  };

  api('/api/me').then(() => { $('login').style.display = 'none'; $('dash').style.display = 'block'; load(); }).catch(() => {});
  `;

  return shell({ title: 'LOKET · admin', body, script });
}

module.exports = { publicPage, adminPage, qrSvg: (text) => QR.toString(text, { type: 'svg', margin: 0, width: 132 }) };
