'use strict';

const QR = require('qrcode');

const SHELL_CSS = `
:root{--bg:#0a0a0c;--card:#141418;--line:#24242c;--fg:#f2f2f5;--muted:#8b8b96;--accent:#fff;--ok:#34d399;--warn:#fbbf24;--bad:#f87171}
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:var(--bg);color:var(--fg);min-height:100%}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;line-height:1.4}
.wrap{max-width:720px;margin:0 auto;padding:16px 14px 48px}
.nav{position:sticky;top:0;z-index:50;display:flex;align-items:center;gap:12px;background:rgba(10,10,12,.86);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-bottom:1px solid var(--line);padding:11px 14px}
.burger{width:40px;height:40px;flex:0 0 auto;background:var(--card);border:1px solid var(--line);border-radius:10px;color:var(--fg);font-size:18px;line-height:1;cursor:pointer}
.navbrand{font-size:16px;font-weight:800;letter-spacing:-.02em;white-space:nowrap}
.navbrand b{background:var(--accent);color:#000;padding:2px 7px;border-radius:5px;margin-right:6px}
.navtitle{flex:1;text-align:right;font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.06em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.menu{position:fixed;top:62px;left:14px;right:14px;z-index:49;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:6px;display:none;box-shadow:0 18px 40px rgba(0,0,0,.55)}
.menu.open{display:block}
.menu a{display:block;padding:13px 14px;border-radius:10px;color:var(--fg);text-decoration:none;font-size:14px;font-weight:600}
.menu a.on{background:var(--accent);color:#000}
.menu a:active{background:#1a1a20}
@media(min-width:640px){.menu{left:auto;right:14px;width:250px}}
`;

const MENU_ITEMS = [
  { href: '/', key: 'dashboard', label: 'Dashboard' },
  { href: '/vpn', key: 'vpn', label: 'Create VPN' },
  { href: '/admin', key: 'admin', label: 'Dashboard Admin' },
];

function pageShell({ active = '', title = 'Loket VPN', innerHtml = '' } = {}) {
  const menu = MENU_ITEMS.map((i) =>
    `<a href="${i.href}" class="${i.key === active ? 'on' : ''}">${i.label}</a>`
  ).join('');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} — Loket VPN</title>
<style>${SHELL_CSS}</style>
</head>
<body>
<header class="nav">
  <button class="burger" id="burger" type="button" aria-label="Menu">☰</button>
  <div class="navbrand"><b>LOKET</b>VPN</div>
  <div class="navtitle">${title}</div>
</header>
<nav class="menu" id="menu">${menu}</nav>
<main class="wrap">${innerHtml}</main>
<script>
(function(){
  var b=document.getElementById('burger'), m=document.getElementById('menu');
  b.addEventListener('click', function(e){ e.stopPropagation(); m.classList.toggle('open'); });
  document.addEventListener('click', function(e){ if(!m.contains(e.target)) m.classList.remove('open'); });
})();
</script>
</body>
</html>`;
}

// ---------------------------------------------------------------- catalog (Create VPN)

function catalogInner({ nodes = [] } = {}) {
  const payload = JSON.stringify(nodes.map((n) => ({
    id: n.id,
    name: n.name || n.id,
    flag: (n.flag || n.cc || 'XX').toUpperCase(),
    proxy: n.proxy || '',
  }))).replace(/</g, '\\u003c');

  return `<style>
.field label{display:block;font-size:9px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-bottom:5px}
.filters{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px;margin-bottom:14px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.grid .full{grid-column:1/-1}
@media(min-width:640px){.grid{grid-template-columns:repeat(5,1fr)}.grid .full{grid-column:auto}}
.field select,.field input{width:100%;height:38px;background:#0e0e12;color:var(--fg);border:1px solid var(--line);border-radius:9px;padding:0 10px;font-size:13px;font-family:inherit;outline:none;appearance:none}
.field select{background-image:url("data:image/svg+xml;charset=utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%238b8b96'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 10px center;padding-right:26px}
.field select:focus,.field input:focus{border-color:#3a3a46}
.pagetitle{display:flex;align-items:baseline;justify-content:space-between;margin:4px 2px 12px}
.pagetitle h1{font-size:18px;font-weight:800;letter-spacing:-.02em}
.pagetitle .cnt{font-size:11px;color:var(--muted);font-family:ui-monospace,monospace}
.list{background:var(--card);border:1px solid var(--line);border-radius:14px;overflow:hidden}
.row{display:flex;align-items:stretch;border-bottom:1px solid var(--line)}
.row:last-child{border-bottom:none}
.row:active{background:#1a1a20}
.info{display:flex;align-items:center;gap:12px;flex:1;min-width:0;padding:11px 13px}
.flag{font-size:21px;line-height:1;flex:0 0 auto}
.meta{flex:1;min-width:0}
.ip{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nm{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.st{font-size:10px;font-weight:700;margin-top:3px;font-family:ui-monospace,monospace}
.st.ok{color:var(--ok)}.st.warn{color:var(--warn)}.st.bad{color:var(--bad)}.st.load{color:var(--muted)}
.skel{display:inline-block;width:52px;height:9px;border-radius:4px;background:var(--muted);opacity:.25}
.copy{flex:0 0 62px;display:flex;align-items:center;justify-content:center;border:none;border-left:1px solid var(--line);background:transparent;color:var(--fg);font-size:10px;font-weight:800;letter-spacing:.08em;cursor:pointer;font-family:inherit;transition:.15s}
.copy:active,.copy.done{background:#fff;color:#000}
.empty{padding:34px 16px;text-align:center;color:var(--muted);font-size:13px}
.pager{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:14px}
.pager button{background:var(--card);border:1px solid var(--line);color:var(--fg);border-radius:9px;padding:9px 16px;font-size:10px;font-weight:800;letter-spacing:.08em;cursor:pointer;font-family:inherit}
.pager button:disabled{opacity:.3}
.pager span{font-size:11px;color:var(--muted);font-family:ui-monospace,monospace}
#toast{position:fixed;left:50%;bottom:26px;transform:translate(-50%,80px);background:#fff;color:#000;font-size:12px;font-weight:700;padding:10px 18px;border-radius:10px;opacity:0;transition:.22s;pointer-events:none;max-width:88vw;text-align:center;z-index:60}
#toast.show{transform:translate(-50%,0);opacity:1}
</style>
<div class="pagetitle">
  <h1>Create VPN</h1>
  <span class="cnt" id="count">${nodes.length} nodes</span>
</div>

<div class="filters">
  <div class="grid">
    <div class="field"><label for="f-proto">Protocol</label><select id="f-proto"><option value="vless">VLESS</option><option value="vmess">VMESS</option><option value="trojan">TROJAN</option></select></div>
    <div class="field"><label for="f-sec">Security</label><select id="f-sec"><option value="tls">TLS 443</option><option value="none">Non-TLS 80</option></select></div>
    <div class="field"><label for="f-bug">Bug SNI</label><select id="f-bug"><option value="">Default</option><option value="support.zoom.us">Zoom</option><option value="ava.game.naver.com">Naver</option><option value="quiz.int.vidio.com">Vidio</option><option value="graph.instagram.com">Instagram</option></select></div>
    <div class="field"><label for="f-cc">Location</label><select id="f-cc"><option value="ALL">All</option></select></div>
    <div class="field full"><label for="f-q">Search</label><input id="f-q" type="text" placeholder="IP or provider" autocomplete="off"></div>
  </div>
</div>

<div class="list" id="list"></div>
<div class="pager">
  <button id="prev" type="button">PREV</button>
  <span id="pinfo"></span>
  <button id="next" type="button">NEXT</button>
</div>
<div id="toast"></div>

<script>
(function(){
  var NODES = ${payload};
  var PAGE_SIZE = 20;
  var page = 0;
  var filtered = NODES;
  var $ = function(id){ return document.getElementById(id); };
  var listEl = $('list'), pinfo = $('pinfo'), prev = $('prev'), next = $('next');

  function flagOf(cc){
    if(!cc || cc.length !== 2) return '\uD83C\uDF10';
    return cc.replace(/./g, function(c){ return String.fromCodePoint(127397 + c.charCodeAt(0)); });
  }
  function endpoint(proxyStr){
    try{
      var raw = proxyStr || '';
      if(!/^[a-z]+:\\/\\//i.test(raw)) raw = 'http://' + raw;
      var u = new URL(raw);
      return { ip: u.hostname || '—', port: u.port || '80' };
    }catch(e){ return { ip: '—', port: '80' }; }
  }

  function render(){
    var cc = $('f-cc').value, q = $('f-q').value.trim().toLowerCase();
    filtered = NODES.filter(function(n){
      if(cc !== 'ALL' && n.flag !== cc) return false;
      if(q && n.name.toLowerCase().indexOf(q) < 0 && n.proxy.toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    if(page >= pages) page = pages - 1;
    var slice = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    $('count').textContent = filtered.length + ' nodes';

    if(!slice.length){
      listEl.innerHTML = '<div class="empty">No nodes match this filter.</div>';
    }else{
      var html = '';
      for(var i = 0; i < slice.length; i++){
        var n = slice[i], ep = endpoint(n.proxy), idx = page * PAGE_SIZE + i;
        html += '<div class="row">'
          + '<div class="info"><span class="flag">' + flagOf(n.flag) + '</span>'
          + '<div class="meta"><div class="ip">' + ep.ip + '</div>'
          + '<div class="nm">' + n.name + '</div>'
          + '<div class="st load" id="st' + idx + '"><span class="skel"></span></div></div></div>'
          + '<button class="copy" type="button" data-node="' + n.id + '" data-name="' + n.name + '">COPY</button>'
          + '</div>';
      }
      listEl.innerHTML = html;
    }

    pinfo.textContent = (page + 1) + ' / ' + pages;
    prev.disabled = page <= 0;
    next.disabled = page >= pages - 1;

    for(var j = 0; j < slice.length; j++){
      (function(k){
        var ep = endpoint(slice[k].proxy);
        setTimeout(function(){ check(page * PAGE_SIZE + k, ep.ip, ep.port); }, k * 90);
      })(j);
    }
  }

  function check(idx, ip, port){
    var el = $('st' + idx);
    if(!el || !ip || ip === '—') return;
    fetch('/api/check-proxy?ip=' + encodeURIComponent(ip) + '&port=' + encodeURIComponent(port))
      .then(function(r){ return r.json(); }).then(function(d){
        if(d.status === 'Active'){
          el.className = 'st ' + (d.ping_ms < 300 ? 'ok' : 'warn');
          el.textContent = '● ' + d.ping_ms + ' ms';
        }else{ el.className = 'st bad'; el.textContent = '● OFFLINE'; }
      }).catch(function(){ el.className = 'st bad'; el.textContent = '● ERROR'; });
  }

  var toast = $('toast'), toastTimer = null;
  function showToast(msg){ toast.textContent = msg; toast.className = 'show'; clearTimeout(toastTimer); toastTimer = setTimeout(function(){ toast.className = ''; }, 1800); }

  listEl.addEventListener('click', function(e){
    var btn = e.target.closest('.copy');
    if(!btn) return;
    var proto = $('f-proto').value, sec = $('f-sec').value, bug = $('f-bug').value;
    var qs = '/api/config?node=' + encodeURIComponent(btn.getAttribute('data-node'))
      + '&sec=' + encodeURIComponent(sec) + '&bug=' + encodeURIComponent(bug);
    fetch(qs).then(function(r){ return r.json(); }).then(function(d){
      var cfg = (sec === 'tls' && d.native && d.native[proto]) ? d.native[proto] : (d.argo && d.argo[proto]);
      if(!cfg) throw new Error('no config');
      return navigator.clipboard.writeText(cfg).then(function(){
        btn.textContent = 'OK'; btn.className = 'copy done';
        setTimeout(function(){ btn.textContent = 'COPY'; btn.className = 'copy'; }, 1400);
        showToast('Copied ' + btn.getAttribute('data-name'));
      });
    }).catch(function(){ showToast('Failed to copy'); });
  });

  $('f-cc').innerHTML = '<option value="ALL">All</option>'
    + Array.from(new Set(NODES.map(function(n){ return n.flag; }))).sort()
        .map(function(c){ return '<option value="' + c + '">' + flagOf(c) + ' ' + c + '</option>'; }).join('');

  ['f-proto','f-sec','f-bug','f-cc'].forEach(function(id){
    $(id).addEventListener('change', function(){ page = 0; render(); });
  });
  $('f-q').addEventListener('input', function(){ page = 0; render(); });
  prev.addEventListener('click', function(){ if(page > 0){ page--; render(); } });
  next.addEventListener('click', function(){ page++; render(); });

  render();
})();
</script>`;
}

function publicPage({ nodes = [] } = {}) {
  return pageShell({ active: 'vpn', title: 'Create VPN', innerHtml: catalogInner({ nodes }) });
}

function dashboardPage() {
  return pageShell({
    active: 'dashboard',
    title: 'Dashboard',
    innerHtml: `<style>
.placeholder{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:48px 20px;text-align:center;margin-top:8px}
.placeholder h1{font-size:18px;font-weight:800;margin-bottom:8px}
.placeholder p{font-size:13px;color:var(--muted);margin-bottom:20px}
.placeholder .cta{display:inline-block;background:var(--accent);color:#000;font-weight:800;font-size:13px;padding:12px 22px;border-radius:10px;text-decoration:none}
.placeholder .cta:active{opacity:.8}
</style>
<div class="placeholder">
  <h1>Dashboard</h1>
  <p>Belum ada konten. Node &amp; generator ada di halaman Create VPN.</p>
  <a class="cta" href="/vpn">Buka Create VPN →</a>
</div>`,
  });
}

function adminPage({ host = '' } = {}) {
  const innerHtml = `<style>
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px;max-width:800px;margin:0 auto 20px}
h2{margin-bottom:12px;color:var(--fg)}
textarea{width:100%;height:150px;background:#0d0f14;border:1px solid #333;color:#fff;border-radius:8px;padding:10px;font-family:ui-monospace,monospace}
input.txt{width:100%;height:40px;background:#0d0f14;border:1px solid #333;color:#fff;border-radius:8px;padding:0 12px;font-family:ui-monospace,monospace}
.row{display:flex;gap:8px}
button.act{background:#3b82f6;color:#fff;border:none;padding:10px 20px;border-radius:8px;cursor:pointer;font-weight:bold;margin-top:10px}
button.act:hover{background:#2563eb}
button.act:disabled{opacity:.5;cursor:default}
.status{margin-top:10px;font-size:13px;color:#94a3b8}
.msg{margin-top:10px;font-size:13px}
.msg.err{color:#f87171}
</style>

<div class="card" id="login">
  <h2>Masuk Admin</h2>
  <div class="row"><input class="txt" id="p" type="password" placeholder="ADMIN_PASS"><button class="act" id="loginBtn" style="margin-top:0">Masuk</button></div>
  <div class="msg" id="lmsg"></div>
</div>

<div id="dash" style="display:none">
  <div class="card">
    <h2>⚡ Proxy Scanner & Node Importer</h2>
    <p style="font-size:13px;color:#94a3b8;margin-bottom:12px">Paste proxy raw / ProxyCheck report atau upload file txt untuk update multi-node.</p>
    <textarea id="proxy-input" placeholder="Paste proxy report di sini..."></textarea>
    <div><input type="file" id="file-input" accept=".txt" style="margin-top:10px" /></div>
    <button class="act" onclick="startScan()">⚡ Start Scan & Hot-Reload</button>
    <div id="scan-status" class="status"></div>
  </div>
  <div class="card">
    <h2>🌐 Pull Fresh Proxies</h2>
    <p style="font-size:13px;color:#94a3b8;margin-bottom:12px">Tarik proxy publik fresh dari hideip.me + sunny9577, probe otomatis, enrich ASN/geo offline, lalu merge ke node list.</p>
    <button class="act" id="pull-btn" onclick="pullFresh()">🌐 Pull &amp; Merge</button>
    <div id="pull-status" class="status"></div>
  </div>
  <p style="text-align:center"><button class="act" onclick="logout()" style="background:#ef4444">Keluar</button></p>
</div>

<script>
var csrf = '';
var $ = function(id){ return document.getElementById(id); };

async function api(path, opts) {
  opts = opts || {};
  opts.credentials = 'same-origin';
  opts.headers = Object.assign({ 'content-type': 'application/json', 'x-csrf-token': csrf }, opts.headers || {});
  var res = await fetch(path, opts);
  var data = await res.json().catch(function(){ return {}; });
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

$('loginBtn').addEventListener('click', async function(){
  try {
    var r = await api('/api/login', { method: 'POST', body: JSON.stringify({ password: $('p').value }) });
    csrf = r.csrf;
    $('login').style.display = 'none';
    $('dash').style.display = 'block';
  } catch (e) { $('lmsg').className = 'msg err'; $('lmsg').textContent = e.message; }
});

async function logout(){
  try { await api('/api/logout', { method: 'POST' }); } catch (e) {}
  location.reload();
}

$('file-input').addEventListener('change', function(e) {
  var file = e.target.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function(evt) { $('proxy-input').value = evt.target.result; };
  reader.readAsText(file);
});

async function startScan() {
  var text = $('proxy-input').value;
  var status = $('scan-status');
  if (!text.trim()) return alert('Paste proxy report dulu!');
  status.textContent = 'Scanning and verifying nodes... mohon tunggu...';
  try {
    var d = await api('/api/admin/scan', { method: 'POST', body: JSON.stringify({ text: text, save: true }) });
    status.textContent = 'Selesai! Live nodes: ' + d.live + ' / ' + d.total + '. Volume updated!';
  } catch (e) { status.textContent = 'Error: ' + e.message; }
}

async function pullFresh() {
  var btn = $('pull-btn');
  var status = $('pull-status');
  btn.disabled = true;
  status.textContent = 'Fetching + probing proxies (bisa 1-3 menit)...';
  try {
    var d = await api('/api/admin/pull', { method: 'POST', body: JSON.stringify({ limit: 400, concurrency: 24 }) });
    status.textContent = 'Selesai! Fetched ' + d.fetched + ', live ' + d.live + ', added ' + d.added + ', total node ' + d.total + '.';
  } catch (e) { status.textContent = 'Error: ' + e.message; }
  finally { btn.disabled = false; }
}

// auto-login if session still valid
api('/api/me').then(function(){ $('login').style.display = 'none'; $('dash').style.display = 'block'; }).catch(function(){});
</script>`;

  return pageShell({ active: 'admin', title: 'Dashboard Admin', innerHtml });
}

module.exports = {
  publicPage,
  dashboardPage,
  adminPage,
  qrSvg: (text) => QR.toString(text, { type: 'svg', margin: 0, width: 132 }),
};
