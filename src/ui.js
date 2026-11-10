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
<html lang="id">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} — Loket VPN</title>
<style>${SHELL_CSS}</style>
</head>
<body>
<header class="nav">
  <button class="burger" id="burger" type="button" aria-label="Menu" aria-expanded="false" aria-controls="menu">☰</button>
  <div class="navbrand"><b>LOKET</b>VPN</div>
  <div class="navtitle">${title}</div>
</header>
<nav class="menu" id="menu">${menu}</nav>
<main class="wrap">${innerHtml}</main>
<script>
(function(){
  var b=document.getElementById('burger'), m=document.getElementById('menu');
  b.addEventListener('click', function(e){ e.stopPropagation(); m.classList.toggle('open'); b.setAttribute('aria-expanded', String(m.classList.contains('open'))); });
  document.addEventListener('click', function(e){ if(!m.contains(e.target)){ m.classList.remove('open'); b.setAttribute('aria-expanded','false'); } });
})();
</script>
</body>
</html>`;
}

// ---------------------------------------------------------------- catalog (Create VPN)

function catalogInner({ nodes = [], host = 'localhost', wildcardDomain = '', vmessEnabled = false } = {}) {
  const safeNodes = nodes.map((n) => ({
    id: String(n.id || ''),
    name: String(n.name || n.id || 'Node'),
    flag: String(n.flag || n.cc || 'XX').toUpperCase(),
    host: String(n.host || host || 'localhost'),
  }));
  const directHost = String(host || wildcardDomain || 'localhost');
  const payload = JSON.stringify([{ id: '', name: 'Direct', flag: 'XX', host: directHost }, ...safeNodes]).replace(/</g, '\\u003c');
  const protocols = [
    ['vless', 'VLESS'],
    ...(vmessEnabled ? [['vmess', 'VMess']] : []),
    ['trojan', 'Trojan'],
    ['sshWs', 'SSH-WS'],
  ];
  const protocolOptions = protocols.map(([value, label]) => `<option value="${value}">${label}</option>`).join('');

  return `<style>
.field label{display:block;font-size:9px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-bottom:5px}
.filters{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px;margin-bottom:14px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.grid .full{grid-column:1/-1}
@media(min-width:640px){.grid{grid-template-columns:repeat(5,1fr)}.grid .full{grid-column:auto}}
.field select,.field input{width:100%;height:38px;background:#0e0e12;color:var(--fg);border:1px solid var(--line);border-radius:9px;padding:0 10px;font-size:13px;font-family:inherit;outline:none;appearance:none}
.field select{background-image:url("data:image/svg+xml;charset=utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%238b8b96'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 10px center;padding-right:26px}
.field select:focus,.field input:focus{border-color:#737381}.field select:disabled{opacity:.72;cursor:default}
.pagetitle{display:flex;align-items:baseline;justify-content:space-between;margin:4px 2px 5px}.pagetitle h1{font-size:18px;font-weight:800;letter-spacing:-.02em}.pagetitle .cnt{font-size:11px;color:var(--muted);font-family:ui-monospace,monospace}
.subnote{font-size:11px;color:var(--muted);margin:0 2px 12px}
.list{background:var(--card);border:1px solid var(--line);border-radius:14px;overflow:hidden}
.row{display:flex;align-items:stretch;border-bottom:1px solid var(--line)}.row:last-child{border-bottom:none}.row:active{background:#1a1a20}
.info{display:flex;align-items:center;gap:12px;flex:1;min-width:0;padding:11px 13px}.flag{font-size:21px;line-height:1;flex:0 0 auto}.meta{flex:1;min-width:0}
.ip{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.nm{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.st{font-size:10px;font-weight:700;margin-top:3px;font-family:ui-monospace,monospace}.st.ok{color:var(--ok)}.st.load{color:var(--muted)}
.copy{flex:0 0 70px;display:flex;align-items:center;justify-content:center;border:none;border-left:1px solid var(--line);background:transparent;color:var(--fg);font-size:10px;font-weight:800;letter-spacing:.06em;cursor:pointer;font-family:inherit;transition:.15s}.copy:active,.copy.done{background:#fff;color:#000}.copy:disabled{opacity:.4;cursor:wait}
.empty{padding:34px 16px;text-align:center;color:var(--muted);font-size:13px}.pager{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:14px}.pager button{background:var(--card);border:1px solid var(--line);color:var(--fg);border-radius:9px;padding:9px 16px;font-size:10px;font-weight:800;letter-spacing:.08em;cursor:pointer;font-family:inherit}.pager button:disabled{opacity:.3}.pager span{font-size:11px;color:var(--muted);font-family:ui-monospace,monospace}
#result{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:15px;margin:0 0 14px}#result[hidden]{display:none}.rhead{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}.rhead h2{font-size:15px}.rhead p{font-size:11px;color:var(--muted);margin-top:3px}.rclose{background:transparent;color:var(--muted);border:0;font-size:19px;cursor:pointer}.rgrid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.rfield{min-width:0;padding:9px 10px;background:#0e0e12;border:1px solid var(--line);border-radius:9px}.rfield span{display:block;color:var(--muted);font-size:9px;text-transform:uppercase;letter-spacing:.08em}.rfield strong{display:block;margin-top:3px;font-size:12px;overflow-wrap:anywhere}.rconfig{margin-top:10px;padding:10px;background:#0e0e12;border:1px solid var(--line);border-radius:9px;color:var(--fg);font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;overflow-wrap:anywhere;max-height:100px;overflow:auto;user-select:text}.ractions{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:10px}.copy-result{background:#fff;color:#000;border:0;border-radius:8px;padding:9px 12px;font:800 10px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;letter-spacing:.05em;cursor:pointer}.qr-wrap{display:flex;align-items:center;gap:8px;color:var(--muted);font-size:10px}.qr-wrap[hidden]{display:none}.qr-wrap img{width:78px;height:78px;background:#fff;padding:4px;border-radius:7px}
#toast{position:fixed;left:50%;bottom:26px;transform:translate(-50%,80px);background:#fff;color:#000;font-size:12px;font-weight:700;padding:10px 18px;border-radius:10px;opacity:0;transition:.22s;pointer-events:none;max-width:88vw;text-align:center;z-index:60}#toast.show{transform:translate(-50%,0);opacity:1}
</style>
<div class="pagetitle"><h1>Create VPN</h1><span class="cnt" id="count">${nodes.length} nodes</span></div>
<p class="subnote">Pilih protokol dan jalur; tekan CREATE untuk membuat akun baru dan menyalin profil.</p>
<div class="filters"><div class="grid">
  <div class="field"><label for="f-proto">Protocol</label><select id="f-proto">${protocolOptions}</select></div>
  <div class="field"><label for="f-sec">Security</label><select id="f-sec" disabled><option value="tls">TLS 443</option></select></div>
  <div class="field"><label for="f-net">Transport</label><select id="f-net" disabled><option value="ws">WebSocket</option></select></div>
  <div class="field"><label for="f-cc">Location</label><select id="f-cc"><option value="ALL">All</option></select></div>
  <div class="field"><label for="f-q">Search</label><input id="f-q" type="text" placeholder="Node or hostname" autocomplete="off"></div>
</div></div>
<section id="result" hidden aria-live="polite"><div class="rhead"><div><h2>Account ready</h2><p>Simpan username dan password ini.</p></div><button class="rclose" id="close-result" type="button" aria-label="Tutup">×</button></div><div class="rgrid"><div class="rfield"><span>Username</span><strong id="r-user"></strong></div><div class="rfield"><span>Password</span><strong id="r-pass"></strong></div></div><pre class="rconfig" id="r-config"></pre><div class="ractions"><button class="copy-result" id="copy-result" type="button">COPY CONFIG</button><div class="qr-wrap" id="qr-wrap" hidden><span>QR</span><img id="r-qr" alt="QR konfigurasi"></div></div></section>
<div class="list" id="list"></div><div class="pager"><button id="prev" type="button">PREV</button><span id="pinfo"></span><button id="next" type="button">NEXT</button></div><div id="toast" role="status" aria-live="polite"></div>
<script>
(function(){
  var NODES=${payload},PAGE_SIZE=20,page=0,filtered=NODES,currentConfig='';
  var $=function(id){return document.getElementById(id);};
  var listEl=$('list'),pinfo=$('pinfo'),prev=$('prev'),next=$('next'),protocol=$('f-proto');
  function flagOf(cc){var value=String(cc||'');if(value==='XX')return '🌐';if(/^[A-Z]{2}$/.test(value))return value.replace(/./g,function(c){return String.fromCodePoint(127397+c.charCodeAt(0));});return value||'🌐';}
  function esc(value){return String(value).replace(/[&<>"']/g,function(ch){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch];});}
  function toast(message){var el=$('toast');el.textContent=message;el.className='show';clearTimeout(toast.timer);toast.timer=setTimeout(function(){el.className='';},2200);}
  function render(){
    var cc=$('f-cc').value,q=$('f-q').value.trim().toLowerCase();
    filtered=NODES.filter(function(n){return (cc==='ALL'||n.flag===cc)&&(!q||(n.name+' '+n.host+' '+n.id).toLowerCase().indexOf(q)>=0);});
    var pages=Math.max(1,Math.ceil(filtered.length/PAGE_SIZE));if(page>=pages)page=pages-1;
    var slice=filtered.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE);$('count').textContent=(NODES.length-1)+' nodes · Direct';
    if(!slice.length){listEl.innerHTML='<div class="empty">No nodes match this filter.</div>';}
    else{var html='';for(var i=0;i<slice.length;i++){var n=slice[i];html+='<div class="row"><div class="info"><span class="flag">'+flagOf(esc(n.flag))+'</span><div class="meta"><div class="ip">'+esc(n.host)+'</div><div class="nm">'+esc(n.name)+'</div><div class="st ok">● TLS 443 · WebSocket</div></div></div><button class="copy" type="button" data-node="'+esc(n.id)+'" data-name="'+esc(n.name)+'">CREATE</button></div>'; }listEl.innerHTML=html;}
    pinfo.textContent=(page+1)+' / '+pages;prev.disabled=page<=0;next.disabled=page>=pages-1;
  }
  async function copyConfig(){if(!currentConfig)return;try{await navigator.clipboard.writeText(currentConfig);$('copy-result').textContent='COPIED';setTimeout(function(){$('copy-result').textContent='COPY CONFIG';},1400);}catch(e){toast('Pilih teks konfigurasi untuk menyalin.');}}
  $('copy-result').addEventListener('click',copyConfig);$('close-result').addEventListener('click',function(){$('result').hidden=true;});
  listEl.addEventListener('click',async function(e){
    var btn=e.target.closest('.copy');if(!btn)return;btn.disabled=true;btn.textContent='...';
    try{
      var node=btn.getAttribute('data-node')||'';
      var response=await fetch('/api/public/signup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({node:node})});
      var data=await response.json().catch(function(){return {};});if(!response.ok)throw new Error(data.error||'Signup failed');
      var account=data.account,kind=protocol.value;currentConfig=account[kind];if(!currentConfig)throw new Error('Config not available');
      $('r-user').textContent=account.username;$('r-pass').textContent=account.password;$('r-config').textContent=currentConfig;
      var qr=(data.qr||{})[kind];$('qr-wrap').hidden=!qr;if(qr)$('r-qr').src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(qr);
      $('result').hidden=false;copyConfig();toast('Akun '+account.username+' dibuat');$('result').scrollIntoView({behavior:'smooth',block:'nearest'});
    }catch(err){toast(err.message||'Gagal membuat akun');}
    finally{btn.disabled=false;btn.textContent='CREATE';}
  });
  $('f-cc').innerHTML='<option value="ALL">All</option>'+Array.from(new Set(NODES.map(function(n){return n.flag;}))).sort().filter(function(c){return c!=='XX';}).map(function(c){return '<option value="'+esc(c)+'">'+flagOf(c)+' '+esc(c)+'</option>';}).join('');
  ['f-proto','f-cc'].forEach(function(id){$(id).addEventListener('change',function(){page=0;render();});});$('f-q').addEventListener('input',function(){page=0;render();});
  prev.addEventListener('click',function(){if(page>0){page--;render();}});next.addEventListener('click',function(){page++;render();});render();
})();
</script>`;
}

function publicPage({ nodes = [], host = 'localhost', wildcardDomain = '', vmessEnabled = false } = {}) {
  return pageShell({ active: 'vpn', title: 'Create VPN', innerHtml: catalogInner({ nodes, host, wildcardDomain, vmessEnabled }) });
}

function dashboardPage({ nodeCount = 0, vmessEnabled = false } = {}) {
  const count = Math.max(0, Math.floor(Number(nodeCount) || 0));
  const protocolChips = `<span>SSH-WS</span><span>VLESS</span>${vmessEnabled ? '<span>VMess</span>' : ''}<span>Trojan</span>`;
  return pageShell({
    active: 'dashboard',
    title: 'Dashboard',
    innerHtml: `<style>
.dash-hero{position:relative;overflow:hidden;padding:clamp(25px,6vw,46px);border:1px solid #252936;border-radius:24px;background:radial-gradient(ellipse at 90% 0%,rgba(67,116,255,.21),transparent 44%),linear-gradient(145deg,#171a22,#101115);box-shadow:0 20px 50px rgba(0,0,0,.3)}.dash-hero:after{content:"";position:absolute;width:180px;height:180px;right:-76px;bottom:-95px;border:1px solid rgba(255,255,255,.08);border-radius:50%;box-shadow:0 0 0 24px rgba(255,255,255,.025),0 0 0 50px rgba(255,255,255,.018);pointer-events:none}.dash-kicker{display:inline-flex;align-items:center;gap:8px;padding:7px 10px;border:1px solid rgba(83,211,160,.18);border-radius:999px;background:rgba(83,211,160,.08);color:#81e0b7;font-size:10px;font-weight:800;letter-spacing:.09em;text-transform:uppercase}.dash-kicker:before{content:"";width:6px;height:6px;border-radius:50%;background:#54d6a0;box-shadow:0 0 0 4px rgba(84,214,160,.12)}.dash-hero h1{position:relative;z-index:1;margin-top:17px;font-size:clamp(31px,7vw,51px);line-height:1.02;letter-spacing:-.055em}.dash-hero h1 span{color:#9aa5bb}.dash-hero p{position:relative;z-index:1;max-width:475px;margin-top:14px;color:#a4a6b2;font-size:14px}.dash-actions{display:flex;flex-wrap:wrap;gap:9px;margin-top:23px}.dash-btn{display:inline-flex;align-items:center;gap:10px;min-height:43px;padding:0 15px;border:1px solid rgba(255,255,255,.14);border-radius:11px;background:#f3f4f7;color:#111218;text-decoration:none;font-size:12px;font-weight:800}.dash-btn.secondary{background:rgba(255,255,255,.04);color:#ececf2;border-color:#30323b}.dash-meta{display:flex;flex-wrap:wrap;gap:8px;margin-top:20px}.dash-meta span{padding:6px 9px;border:1px solid #292c35;border-radius:8px;color:#a4a6b2;font:10px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}.dash-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px}.dash-card{min-height:140px;padding:17px;border:1px solid var(--line);border-radius:17px;background:linear-gradient(150deg,#16171d,#121317)}.dash-card-head{display:flex;align-items:center;justify-content:space-between;color:var(--muted);font-size:11px;font-weight:700}.dash-icon{width:34px;height:34px;display:grid;place-items:center;border-radius:11px;background:rgba(96,137,255,.1);color:#a9bbff;font-size:16px}.dash-card strong{display:block;margin-top:10px;font-size:30px;line-height:1;letter-spacing:-.04em}.dash-card p{margin-top:8px;color:var(--muted);font-size:11px}.protocol-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:13px}.protocol-chips span{padding:5px 8px;border:1px solid #30323b;border-radius:999px;background:#1a1b22;color:#e4e5eb;font-size:9px;font-weight:750}.dash-footer{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:13px 3px 0;color:var(--muted);font-size:10px}.dash-footer a{color:#c9d2e9;text-decoration:none}.dash-footer a:hover{text-decoration:underline}@media(max-width:500px){.dash-grid{grid-template-columns:1fr}.dash-card{min-height:120px}}
</style>
<section class="dash-hero"><div class="dash-kicker">Private network gateway</div><h1>Koneksi pilihan,<br><span>tanpa langkah rumit.</span></h1><p>Pilih protokol dan jalur node, buat akun, lalu salin profil langsung ke aplikasi klien.</p><div class="dash-actions"><a class="dash-btn" href="/vpn">Buka Create VPN <span aria-hidden="true">→</span></a><a class="dash-btn secondary" href="/admin">Panel admin</a></div><div class="dash-meta"><span>HTTPS · WSS</span><span>TLS 443</span><span>Wildcard hostname</span></div></section>
<section class="dash-grid" aria-label="Ringkasan layanan"><div class="dash-card"><div class="dash-card-head"><span>NODE EGRESS</span><span class="dash-icon" aria-hidden="true">⌖</span></div><strong>${count}</strong><p>Node yang dikonfigurasi operator</p></div><div class="dash-card"><div class="dash-card-head"><span>PROTOKOL</span><span class="dash-icon" aria-hidden="true">⇄</span></div><div class="protocol-chips">${protocolChips}</div><p>Profil publik lewat TLS dan WebSocket</p></div></section>
<div class="dash-footer"><span>Port publik tunggal · HTTP / WebSocket</span><a href="/vpn">Buat akun →</a></div>`,
  });
}

function adminPage({ host = '' } = {}) {
  const innerHtml = `<style>
[hidden]{display:none!important}.admin-login{max-width:460px;margin:8vh auto 0;padding:23px;border:1px solid var(--line);border-radius:16px;background:linear-gradient(150deg,#17181f,#121317);box-shadow:0 18px 50px rgba(0,0,0,.28)}.admin-login h1{font-size:23px;letter-spacing:-.04em}.admin-login p{color:var(--muted);font-size:12px;margin:7px 0 16px}.login-form{display:flex;gap:8px}.input,.textarea{width:100%;min-width:0;background:#0e0e12;color:var(--fg);border:1px solid var(--line);border-radius:9px;padding:10px 12px;font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;outline:none}.input:focus,.textarea:focus{border-color:#5e6372}.btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:36px;padding:0 12px;border:1px solid #343640;border-radius:9px;background:#202127;color:var(--fg);font:700 11px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer;white-space:nowrap}.btn.primary{background:#eef0f5;color:#111218;border-color:#eef0f5}.btn.danger{border-color:#5b3036;background:#2a171a;color:#ff9aa4}.btn:disabled{opacity:.45;cursor:wait}.status{min-height:17px;margin-top:9px;color:var(--muted);font-size:11px}.status.error{color:#ff828c}.admin-head{display:flex;align-items:flex-end;justify-content:space-between;gap:14px;margin:3px 0 15px}.admin-head h1{margin-top:3px;font-size:clamp(25px,5vw,34px);letter-spacing:-.045em}.admin-head p{margin-top:5px;color:var(--muted);font-size:12px}.eyebrow{color:#9aa7c4;font-size:9px;font-weight:800;letter-spacing:.13em;text-transform:uppercase}.toolbar{display:flex;align-items:center;gap:7px}.last-refresh{color:var(--muted);font:10px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:nowrap}.kpi-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.kpi,.card{border:1px solid var(--line);border-radius:14px;background:linear-gradient(150deg,#17181e,#121317)}.kpi{padding:14px;min-height:104px}.kpi span{display:block;color:var(--muted);font-size:9px;font-weight:800;letter-spacing:.09em;text-transform:uppercase}.kpi strong{display:block;margin-top:9px;font-size:24px;line-height:1;letter-spacing:-.04em}.kpi small{display:block;margin-top:7px;color:var(--muted);font-size:10px}.admin-grid{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(230px,.85fr);gap:11px;margin-top:11px}.card{padding:15px;min-width:0}.card-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}.card-head h2{font-size:14px;letter-spacing:-.02em}.card-head p{margin-top:3px;color:var(--muted);font-size:10px}.rate-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.rate-box{padding:10px;border:1px solid var(--line);border-radius:10px;background:#0e0f13}.rate-box span{display:block;color:var(--muted);font-size:9px;text-transform:uppercase;letter-spacing:.08em}.rate-box strong{display:block;margin-top:5px;font:700 20px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}.rate-box.rx strong{color:#81d9ae}.rate-box.tx strong{color:#93a8ff}.rate-box small{color:var(--muted);font-size:9px}.chart-wrap{height:155px;margin-top:11px;border:1px solid #262830;border-radius:10px;background:rgba(8,9,12,.6);overflow:hidden}.chart-wrap svg{width:100%;height:100%;display:block}.chart-grid{stroke:#272932;stroke-width:1}.chart-line{fill:none;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round}.chart-line.rx{stroke:#69d8a6}.chart-line.tx{stroke:#8da4ff}.legend{display:flex;gap:13px;margin-top:8px;color:var(--muted);font-size:9px}.legend span{display:inline-flex;align-items:center;gap:5px}.legend i{width:7px;height:7px;border-radius:50%;display:inline-block}.legend .rx{background:#69d8a6}.legend .tx{background:#8da4ff}.footnote{margin-top:9px;color:var(--muted);font-size:9px;line-height:1.5}.proto-list{display:grid;gap:8px}.proto{padding:9px 10px;border:1px solid var(--line);border-radius:10px;background:#0e0f13}.proto-top{display:flex;align-items:center;justify-content:space-between;gap:8px}.proto-top b{font-size:11px}.proto-top strong{font:700 11px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}.proto small{display:block;margin-top:5px;color:var(--muted);font-size:9px}.section{margin-top:11px}.table-wrap{overflow:auto;border:1px solid var(--line);border-radius:10px}.data-table{width:100%;border-collapse:collapse;min-width:620px;font-size:10px}.data-table th,.data-table td{padding:9px 10px;text-align:left;border-bottom:1px solid #24252c;vertical-align:middle}.data-table th{color:var(--muted);font-size:8px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;background:#101115}.data-table tr:last-child td{border-bottom:0}.data-table td{color:#dedfe6}.muted{color:var(--muted)!important}.pill{display:inline-flex;align-items:center;padding:4px 7px;border-radius:999px;background:#1d2823;color:#86dfb1;font-size:8px;font-weight:800}.pill.warn{background:#30291b;color:#f4c96b}.pill.bad{background:#321d21;color:#ff929c}.table-actions{display:flex;gap:5px}.table-actions .btn{min-height:27px;padding:0 8px;font-size:8px}.node-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.node-action{padding:12px;border:1px solid var(--line);border-radius:11px;background:#0f1014}.node-action h3{font-size:11px}.node-action p{margin:5px 0 9px;color:var(--muted);font-size:9px;line-height:1.45}.textarea{height:92px;resize:vertical;font:10px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}.file-label{display:block;margin:8px 0;color:var(--muted);font-size:9px}.file-label input{display:block;max-width:100%;margin-top:5px;font-size:9px}.node-table{min-width:420px}.card-note{margin-top:8px;color:var(--muted);font-size:9px}.empty-row{padding:16px!important;text-align:center!important;color:var(--muted)!important}.error-text{color:#ff929c!important}@media(max-width:760px){.kpi-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.admin-grid{grid-template-columns:1fr}.admin-head{align-items:flex-start;flex-direction:column}.toolbar{width:100%;justify-content:space-between}}@media(max-width:520px){.login-form{flex-direction:column}.node-grid{grid-template-columns:1fr}.card{padding:12px}.kpi{padding:11px;min-height:96px}.kpi strong{font-size:21px}.last-refresh{font-size:8px}}
</style>
<section class="admin-login" id="login"><p class="eyebrow">Protected area</p><h1>Dashboard admin</h1><p>Masuk untuk memonitor trafik dan mengelola node.</p><form class="login-form" id="login-form"><label class="sr-only" for="admin-password">Kata sandi admin</label><input class="input" id="admin-password" type="password" placeholder="Kata sandi admin" autocomplete="current-password" required><button class="btn primary" id="login-btn" type="submit">Masuk</button></form><div class="status" id="login-status" role="status" aria-live="polite"></div></section>
<div id="admin-app" hidden>
  <header class="admin-head"><div><p class="eyebrow">Operations · Loket Gretongan</p><h1>Dashboard admin</h1><p>Usage, bandwidth, akun, dan status node.</p></div><div class="toolbar"><span class="last-refresh" id="last-refresh">Belum diperbarui</span><button class="btn" id="refresh-btn" type="button">Refresh</button><button class="btn danger" id="logout-btn" type="button">Keluar</button></div></header>
  <section class="kpi-grid" aria-label="Ringkasan"><div class="kpi"><span>Active accounts</span><strong id="kpi-active">—</strong><small id="kpi-users-sub">Menunggu data</small></div><div class="kpi"><span>Active tunnels</span><strong id="kpi-tunnels">—</strong><small>WebSocket relay saat ini</small></div><div class="kpi"><span>Node health</span><strong id="kpi-nodes">—</strong><small id="kpi-nodes-sub">Belum diperiksa</small></div><div class="kpi"><span>Traffic since start</span><strong id="kpi-traffic">—</strong><small id="kpi-uptime">Uptime —</small></div></section>
  <section class="admin-grid"><article class="card"><div class="card-head"><div><h2>Live bandwidth</h2><p>Kecepatan sampel dari byte payload relay</p></div><span class="pill">2 s sample</span></div><div class="rate-grid"><div class="rate-box rx"><span>Upload → gateway</span><strong id="rate-rx">—</strong><small>Mbit/s</small></div><div class="rate-box tx"><span>Gateway → download</span><strong id="rate-tx">—</strong><small>Mbit/s</small></div></div><div class="chart-wrap"><svg viewBox="0 0 600 160" preserveAspectRatio="none" role="img" aria-label="Grafik bandwidth"><path class="chart-grid" d="M0 30H600M0 70H600M0 110H600M0 150H600"/><polyline id="rx-line" class="chart-line rx" points=""/><polyline id="tx-line" class="chart-line tx" points=""/></svg></div><div class="legend"><span><i class="rx"></i>RX · client ke service</span><span><i class="tx"></i>TX · service ke client</span></div><p class="footnote">Kecepatan dihitung dari selisih counter relay setiap 2 detik, bukan tes kecepatan koneksi. Counter total reset saat proses aplikasi restart.</p></article>
  <article class="card"><div class="card-head"><div><h2>Traffic per protocol</h2><p>Akumulasi sejak proses berjalan</p></div></div><div class="proto-list"><div class="proto"><div class="proto-top"><b>SSH over WebSocket</b><strong id="proto-ssh">—</strong></div><small>RX <span id="proto-ssh-rx">—</span> · TX <span id="proto-ssh-tx">—</span></small></div><div class="proto"><div class="proto-top"><b>VLESS</b><strong id="proto-vless">—</strong></div><small>RX <span id="proto-vless-rx">—</span> · TX <span id="proto-vless-tx">—</span></small></div><div class="proto"><div class="proto-top"><b>VMess</b><strong id="proto-vmess">—</strong></div><small>RX <span id="proto-vmess-rx">—</span> · TX <span id="proto-vmess-tx">—</span></small></div><div class="proto"><div class="proto-top"><b>Trojan</b><strong id="proto-trojan">—</strong></div><small>RX <span id="proto-trojan-rx">—</span> · TX <span id="proto-trojan-tx">—</span></small></div></div><p class="footnote">VMess tercatat agregat pada bridge; Xray menangani autentikasi di dalam proses, jadi byte per-user VMess belum tersedia.</p></article></section>
  <section class="card section"><div class="card-head"><div><h2>Accounts &amp; usage</h2><p>Aktivitas dan volume VLESS/Trojan per akun; SSH menampilkan jumlah login.</p></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>User</th><th>Status</th><th>Last seen</th><th>IP</th><th>VLESS + Trojan</th><th>Sessions</th><th>Actions</th></tr></thead><tbody id="users-table"><tr><td colspan="7" class="empty-row">Memuat akun…</td></tr></tbody></table></div></section>
  <section class="card section"><div class="card-head"><div><h2>Recent client IPs</h2><p>Alamat terakhir, koneksi tercatat, dan status blokir.</p></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>IP</th><th>Users</th><th>Connections</th><th>Last seen</th><th>Status</th><th>Action</th></tr></thead><tbody id="ips-table"><tr><td colspan="6" class="empty-row">Memuat IP…</td></tr></tbody></table></div></section>
  <section class="card section"><div class="card-head"><div><h2>Node operations</h2><p>Import manual atau tarik proxy otomatis dan gabungkan ke node list.</p></div><button class="btn" id="refresh-nodes-btn" type="button">Check nodes</button></div><div class="node-grid"><div class="node-action"><h3>Automatic pull · Pull &amp; Merge</h3><p>Tarik proxy fresh, probe otomatis, lalu merge dengan node tersimpan.</p><button class="btn primary" id="pull-btn" type="button">🌐 Pull &amp; Merge</button><div class="status" id="pull-status" role="status" aria-live="polite"></div></div><div class="node-action"><h3>Scan / import</h3><p>Tempel report proxy atau upload file TXT untuk dipindai dan disimpan.</p><textarea class="textarea" id="proxy-input" placeholder="Paste proxy report di sini…"></textarea><label class="file-label">Pilih file TXT<input type="file" id="file-input" accept=".txt,text/plain"></label><button class="btn" id="scan-btn" type="button">Scan &amp; update</button><div class="status" id="scan-status" role="status" aria-live="polite"></div></div></div><div class="table-wrap" style="margin-top:11px"><table class="data-table node-table"><thead><tr><th>Node</th><th>Probe</th><th>Latency</th><th>Proxy</th></tr></thead><tbody id="nodes-table"><tr><td colspan="4" class="empty-row">Belum diperiksa</td></tr></tbody></table></div><p class="card-note">Probe menguji koneksi TCP ke endpoint proxy; bukan jaminan uptime atau kualitas trafik end-to-end.</p></section>
</div>
<script>
(function(){
  var csrf=(document.cookie.match(/(?:^|; )vx_csrf=([^;]*)/)||[])[1]||'';
  var $=function(id){return document.getElementById(id);};
  var started=false,statsTimer=null,overviewTimer=null,previous=null,rxSamples=[],txSamples=[],currentUsers=[],currentIps=[];
  function esc(value){return String(value==null?'':value).replace(/[&<>"']/g,function(ch){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch];});}
  function api(path,opts){opts=opts||{};opts.credentials='same-origin';opts.headers=Object.assign({'content-type':'application/json','x-csrf-token':csrf},opts.headers||{});return fetch(path,opts).then(async function(res){var data=await res.json().catch(function(){return {};});if(!res.ok)throw new Error(data.error||res.statusText);return data;});}
  function bytes(value){var n=Math.max(0,Number(value)||0);if(n<1024)return n+' B';var units=['KB','MB','GB','TB'];var i=-1;do{n/=1024;i++;}while(n>=1024&&i<units.length-1);return n.toFixed(n<10?1:0)+' '+units[i];}
  function rate(value){return (Number(value)||0).toFixed(3);}
  function date(value){if(!value)return '—';var d=new Date(value);return isNaN(d.getTime())?'—':d.toLocaleString('id-ID',{month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit'});}
  function uptime(seconds){var s=Math.max(0,Number(seconds)||0),d=Math.floor(s/86400);s%=86400;var h=Math.floor(s/3600);s%=3600;var m=Math.floor(s/60);return (d?d+'d ':'')+(h?h+'h ':'')+m+'m';}
  function showApp(){if(started)return;started=true;$('login').hidden=true;$('admin-app').hidden=false;loadOverview();loadNodes();pollStats();statsTimer=setInterval(pollStats,2000);overviewTimer=setInterval(loadOverview,15000);}
  function drawChart(){var both=rxSamples.concat(txSamples),max=Math.max.apply(null,both.concat([0.01]));function toPoints(list){return list.map(function(v,i){var x=list.length<2?0:i*600/(list.length-1);var y=150-(v/max)*130;return x.toFixed(1)+','+y.toFixed(1);}).join(' ');} $('rx-line').setAttribute('points',toPoints(rxSamples));$('tx-line').setAttribute('points',toPoints(txSamples));}
  function updateProtocol(id,rx,tx){$('proto-'+id).textContent=bytes(rx+tx);$('proto-'+id+'-rx').textContent=bytes(rx);$('proto-'+id+'-tx').textContent=bytes(tx);}
  async function pollStats(){try{var d=await api('/api/stats'),now=Date.now();var rx=(d.sshRx||0)+(d.vlessRx||0)+(d.trojanRx||0)+(d.vmessRx||0),tx=(d.sshTx||0)+(d.vlessTx||0)+(d.trojanTx||0)+(d.vmessTx||0);if(previous){var dt=Math.max(.25,(now-previous.time)/1000);var r=Math.max(0,(rx-previous.rx)*8/dt/1e6),t=Math.max(0,(tx-previous.tx)*8/dt/1e6);$('rate-rx').textContent=rate(r);$('rate-tx').textContent=rate(t);rxSamples.push(r);txSamples.push(t);if(rxSamples.length>45){rxSamples.shift();txSamples.shift();}drawChart();}else{$('rate-rx').textContent='0.000';$('rate-tx').textContent='0.000';rxSamples=[0];txSamples=[0];drawChart();}previous={rx:rx,tx:tx,time:now};$('kpi-tunnels').textContent=Number(d.activeWs||0).toLocaleString('id-ID');$('kpi-traffic').textContent=bytes(rx+tx);$('kpi-uptime').textContent='Uptime '+uptime(d.uptime);updateProtocol('ssh',d.sshRx||0,d.sshTx||0);updateProtocol('vless',d.vlessRx||0,d.vlessTx||0);updateProtocol('vmess',d.vmessRx||0,d.vmessTx||0);updateProtocol('trojan',d.trojanRx||0,d.trojanTx||0);}catch(err){$('last-refresh').textContent='Stats: '+err.message;}}
  function renderUsers(users){currentUsers=users||[];var active=currentUsers.filter(function(u){return u.active&&!u.blocked;}).length,blocked=currentUsers.filter(function(u){return u.blocked;}).length;$('kpi-active').textContent=active.toLocaleString('id-ID');$('kpi-users-sub').textContent=currentUsers.length+' total · '+blocked+' blocked';if(!currentUsers.length){$('users-table').innerHTML='<tr><td colspan="7" class="empty-row">Belum ada akun.</td></tr>';return;}$('users-table').innerHTML=currentUsers.map(function(u){var status=u.blocked?'<span class="pill bad">BLOCKED</span>':(u.active?'<span class="pill">ACTIVE</span>':'<span class="pill warn">EXPIRED</span>');var userBytes=((u.bytes||{}).vless||0)+((u.bytes||{}).trojan||0);var sess=u.sessions||{};var sessions=(sess.ssh||0)+' SSH · '+((sess.vless||0)+(sess.trojan||0))+' V/T';return '<tr><td><strong>'+esc(u.username)+'</strong></td><td>'+status+'</td><td>'+esc(date(u.lastSeen))+'</td><td>'+esc(u.ip||'—')+'</td><td>'+esc(bytes(userBytes))+'</td><td>'+esc(sessions)+'</td><td><div class="table-actions"><button class="btn" data-action="user-block" data-user="'+esc(u.username)+'">'+(u.blocked?'Unblock':'Block')+'</button><button class="btn danger" data-action="user-delete" data-user="'+esc(u.username)+'">Delete</button></div></td></tr>';}).join('');}
  function renderIps(ips){currentIps=ips||[];if(!currentIps.length){$('ips-table').innerHTML='<tr><td colspan="6" class="empty-row">Belum ada alamat tercatat.</td></tr>';return;}$('ips-table').innerHTML=currentIps.slice(0,50).map(function(rec){return '<tr><td><strong>'+esc(rec.ip)+'</strong></td><td>'+esc((rec.users||[]).length)+'</td><td>'+esc(rec.conns||0)+'</td><td>'+esc(date(rec.lastSeen))+'</td><td>'+(rec.blocked?'<span class="pill bad">BLOCKED</span>':'<span class="pill">ALLOWED</span>')+'</td><td><button class="btn" data-action="ip-block" data-ip="'+esc(rec.ip)+'">'+(rec.blocked?'Unblock':'Block')+'</button></td></tr>';}).join('');}
  async function loadOverview(){try{var d=await api('/api/admin/overview');renderUsers(d.users);renderIps(d.ips);}catch(err){$('last-refresh').textContent='Usage: '+err.message;}}
  async function loadNodes(){var tbody=$('nodes-table'),btn=$('refresh-nodes-btn');btn.disabled=true;try{var d=await api('/api/admin/nodes'),nodes=d.nodes||[],healthy=nodes.filter(function(n){return n.ok;}).length;$('kpi-nodes').textContent=nodes.length.toLocaleString('id-ID');$('kpi-nodes-sub').textContent=healthy+' reachable · '+(nodes.length-healthy)+' unavailable';if(!nodes.length)tbody.innerHTML='<tr><td colspan="4" class="empty-row">Tidak ada node egress; jalur direct tersedia.</td></tr>';else tbody.innerHTML=nodes.map(function(n){return '<tr><td><strong>'+esc(n.name||n.id)+'</strong><br><span class="muted">'+esc(n.id)+'</span></td><td>'+(n.ok?'<span class="pill">REACHABLE</span>':'<span class="pill bad">OFFLINE</span>')+'</td><td>'+esc(n.ms||0)+' ms</td><td>'+esc(n.proxy||'direct')+'</td></tr>';}).join('');}catch(err){tbody.innerHTML='<tr><td colspan="4" class="empty-row error-text">Gagal memeriksa node: '+esc(err.message)+'</td></tr>';}$('last-refresh').textContent='Updated '+new Date().toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit',second:'2-digit'});btn.disabled=false;}
  $('login-form').addEventListener('submit',function(e){e.preventDefault();$('login-status').textContent='';api('/api/login',{method:'POST',body:JSON.stringify({password:$('admin-password').value})}).then(function(d){csrf=d.csrf||csrf;showApp();}).catch(function(err){$('login-status').className='status error';$('login-status').textContent=err.message;});});
  $('logout-btn').addEventListener('click',function(){if(statsTimer)clearInterval(statsTimer);if(overviewTimer)clearInterval(overviewTimer);api('/api/logout',{method:'POST'}).catch(function(){}).finally(function(){location.reload();});});
  $('refresh-btn').addEventListener('click',function(){loadOverview();loadNodes();pollStats();});$('refresh-nodes-btn').addEventListener('click',loadNodes);
  $('users-table').addEventListener('click',async function(e){var b=e.target.closest('button[data-action]');if(!b)return;var user=b.getAttribute('data-user'),action=b.getAttribute('data-action'),rec=currentUsers.find(function(u){return u.username===user;});if(!rec)return;try{if(action==='user-delete'){if(!confirm('Hapus akun '+user+'?'))return;await api('/api/users?username='+encodeURIComponent(user),{method:'DELETE'});}else{await api('/api/admin/block',{method:'POST',body:JSON.stringify({type:'user',value:user,block:!rec.blocked})});}await loadOverview();}catch(err){alert(err.message);}});
  $('ips-table').addEventListener('click',async function(e){var b=e.target.closest('button[data-action="ip-block"]');if(!b)return;var ip=b.getAttribute('data-ip'),rec=currentIps.find(function(x){return x.ip===ip;});try{await api('/api/admin/block',{method:'POST',body:JSON.stringify({type:'ip',value:ip,block:!(rec&&rec.blocked)})});await loadOverview();}catch(err){alert(err.message);}});
  $('pull-btn').addEventListener('click',async function(){var btn=$('pull-btn'),status=$('pull-status');btn.disabled=true;status.textContent='Menarik dan memeriksa proxy. Tunggu hingga proses selesai…';try{var d=await api('/api/admin/pull',{method:'POST',body:JSON.stringify({limit:400,concurrency:24})});status.textContent='Selesai · fetched '+d.fetched+', reachable '+d.live+', added '+d.added+', total '+d.total+'.';await loadNodes();}catch(err){status.textContent='Gagal: '+err.message;}finally{btn.disabled=false;}});
  $('file-input').addEventListener('change',function(e){var file=e.target.files[0];if(!file)return;var reader=new FileReader();reader.onload=function(event){$('proxy-input').value=event.target.result;};reader.readAsText(file);});
  $('scan-btn').addEventListener('click',async function(){var text=$('proxy-input').value,status=$('scan-status'),btn=$('scan-btn');if(!text.trim()){status.textContent='Paste report terlebih dahulu.';return;}btn.disabled=true;status.textContent='Memindai dan memverifikasi node…';try{var d=await api('/api/admin/scan',{method:'POST',body:JSON.stringify({text:text,save:true})});status.textContent='Selesai · reachable '+d.live+' dari '+d.total+' kandidat.';await loadNodes();}catch(err){status.textContent='Gagal: '+err.message;}finally{btn.disabled=false;}});
  api('/api/me').then(showApp).catch(function(){});
})();
</script>`;
  return pageShell({ active: 'admin', title: 'Dashboard Admin', innerHtml });
}

module.exports = {
  publicPage,
  dashboardPage,
  adminPage,
  qrSvg: (text) => QR.toString(text, { type: 'svg', margin: 0, width: 132 }),
};
