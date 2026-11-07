'use strict';

function esc(s = '') {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * publicPage: Direct 100% extraction from argo-node HTML/CSS template
 * Extended with Country & Provider 2-level Cascading Selector.
 */
function publicPage({ host = '', nodes = [] } = {}) {
  // Mapping Country Code -> Full Country Name & Flag
  const flagOf = (cc) => cc.replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));

  // Group nodes by CC
  const regionMap = {};
  for (const n of nodes) {
    const cc = (n.flag || 'US').toUpperCase();
    if (!regionMap[cc]) regionMap[cc] = [];
    regionMap[cc].push(n);
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ARGO TUNNEL</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    html{-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;scroll-behavior:smooth}
    body{
      background:#07080A;
      color:#F2F2F2;
      font-family:-apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter", "Helvetica Neue", Helvetica, Arial, sans-serif;
      min-height:100vh;
      display:flex;
      flex-direction:column;
      align-items:center;
      padding:56px 20px 40px;
      overflow-x:hidden;
      perspective:1200px;
      position:relative;
    }
    .bg-image{
      position:fixed;
      inset:0;
      z-index:-2;
      background-image:url('https://r2-storage-8yf.pages.dev/f/Walpaper/%E0%B9%81%E0%B8%A1%E0%B8%87%E0%B8%A1%E0%B8%B8%E0%B8%A1%E0%B8%A1%E0%B8%82%E0%B8%A2%E0%B8%B8%E0%B9%88%E0%B8%A1%E0%B8%AB%E0%B8%B1%E0%B8%A7%E2%80%A6.%F0%9F%A9%B7%F0%9F%95%B8%EF%B8%8F%F0%9F%95%B7%EF%B8%8F%20(1).jpg');
      background-size:cover;
      background-position:center center;
      background-repeat:no-repeat;
      filter:brightness(0.98) contrast(1.02) saturate(1.06);
      animation:kenBurns 28s ease-in-out infinite alternate;
      will-change:transform;
      transform-origin:center center;
    }
    .bg-overlay{
      position:fixed;
      inset:0;
      z-index:-1;
      background:rgba(0,0,0,0.08);
      backdrop-filter:brightness(0.95);
      -webkit-backdrop-filter:brightness(0.95);
      pointer-events:none;
    }
    .bg-orbs{ position:fixed; inset:0; pointer-events:none; overflow:hidden; z-index:0; opacity:0.10; }
    .orb{ position:absolute; border-radius:50%; filter:blur(60px); opacity:0.28; will-change:transform; }
    .orb1{ width:520px; height:520px; left:-100px; top:-60px; background:radial-gradient(circle at 30% 30%, rgba(255,255,255,0.10) 0%, transparent 70%); animation:floatA 20s ease-in-out infinite; }
    .orb2{ width:560px; height:560px; right:-120px; bottom:-100px; background:radial-gradient(circle at 70% 70%, rgba(255,255,255,0.06) 0%, transparent 70%); animation:floatB 24s ease-in-out infinite; }
    @keyframes kenBurns{ 0%{ transform:scale(1)} 50%{ transform:scale(1.04)} 100%{ transform:scale(1.07)}}
    @keyframes floatA{ 0%,100%{ transform:translate3d(0,0,0) scale(1)} 50%{ transform:translate3d(12px,16px,0) scale(1.03)}}
    @keyframes floatB{ 0%,100%{ transform:translate3d(0,0,0) scale(1)} 50%{ transform:translate3d(-10px,-12px,0) scale(1.02)}}
    .shell{
      width:100%;
      max-width:520px;
      position:relative;
      z-index:1;
      transform-style:preserve-3d;
      will-change:transform;
    }
    .panel{
      background:rgba(8,10,14,0.32);
      backdrop-filter:none;
      -webkit-backdrop-filter:none;
      border:1px solid rgba(255,255,255,0.09);
      border-radius:20px;
      overflow:hidden;
      box-shadow:0 16px 48px rgba(0,0,0,0.55), 0 1px 0 rgba(255,255,255,0.06) inset, 0 0 0 1px rgba(255,255,255,0.02) inset;
      transform:translateZ(0);
      transition:box-shadow 0.4s ease, border-color 0.4s ease;
    }
    .panel:hover{ border-color:rgba(255,255,255,0.11); box-shadow:0 20px 56px rgba(0,0,0,0.6), 0 1px 0 rgba(255,255,255,0.08) inset; }
    .header{
      height:56px;
      display:flex;
      align-items:center;
      justify-content:center;
      border-bottom:1px solid rgba(255,255,255,0.06);
      background:rgba(8,10,14,0.26);
      backdrop-filter:none;
      -webkit-backdrop-filter:none;
    }
    .brand{
      font-size:13px;
      font-weight:700;
      letter-spacing:0.28em;
      text-transform:uppercase;
      color:#FFFFFF;
      text-shadow:0 1px 14px rgba(0,0,0,0.55), 0 0 18px rgba(0,0,0,0.35);
    }
    .content{ padding:26px 26px 22px; }
    .eyebrow{
      font-size:12px;
      font-weight:600;
      letter-spacing:0.12em;
      text-transform:uppercase;
      color:#F2F2F2;
      margin-bottom:12px;
      text-shadow:0 1px 10px rgba(0,0,0,0.65);
    }
    .group{ margin-bottom:16px; background:rgba(8,10,14,0.26); backdrop-filter:none; -webkit-backdrop-filter:none; border:1px solid rgba(255,255,255,0.09); border-radius:14px; padding:14px; box-shadow:inset 0 1px 0 rgba(255,255,255,0.04); transition:transform 0.35s cubic-bezier(0.23,1,0.32,1), border-color 0.3s ease, background 0.3s ease; transform:translateZ(0);}
    .group:hover{ border-color:rgba(255,214,10,0.12); background:rgba(8,10,14,0.32); }
    .group.reveal{ opacity:0; transform:translateY(18px) translateZ(0); transition:opacity 0.9s cubic-bezier(0.22,1,0.36,1), transform 0.9s cubic-bezier(0.22,1,0.36,1), border-color 0.3s ease, background 0.3s ease; }
    .group.reveal.in{ opacity:1; transform:translateY(0) translateZ(0); }
    .group:last-of-type{ margin-bottom:0; }
    .group-head{
      display:flex;
      align-items:center;
      gap:8px;
      margin-bottom:10px;
    }
    .group-line{
      width:14px;
      height:1px;
      background:linear-gradient(90deg, rgba(125,211,224,0.95) 0%, rgba(14,47,90,0.25) 100%);
      box-shadow:0 0 8px rgba(125,211,224,0.45);
    }
    .grid-2{ display:grid; grid-template-columns:1fr 1fr; gap:8px; }
    .grid-3{ display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; }
    
    .select-style{
      width:100%;
      height:44px;
      background:rgba(8,10,14,0.35);
      border:1px solid rgba(255,255,255,0.12);
      border-radius:11px;
      color:#E8E8E8;
      padding:0 14px;
      font-size:13px;
      outline:none;
      transition:border-color 0.2s ease, background 0.2s ease;
      cursor:pointer;
    }
    .select-style:focus{ border-color:rgba(125,211,224,0.45); }
    .select-style option{ background:#101319; color:#FFF; }

    button.proto{
      height:44px;
      background:rgba(8,10,14,0.22);
      backdrop-filter:none;
      -webkit-backdrop-filter:none;
      border:1px solid rgba(255,255,255,0.09);
      border-radius:11px;
      color:#E8E8E8;
      font-size:13px;
      font-weight:550;
      letter-spacing:0.02em;
      cursor:pointer;
      transition:all 0.22s cubic-bezier(0.23,1,0.32,1);
      box-shadow:inset 0 1px 0 rgba(255,255,255,0.05), 0 2px 10px rgba(0,0,0,0.25);
      position:relative;
      overflow:hidden;
    }
    button.proto::before{
      content:"";
      position:absolute;
      inset:0;
      background:linear-gradient(180deg, rgba(255,255,255,0.06) 0%, transparent 55%);
      opacity:0;
      transition:opacity 0.22s ease;
      pointer-events:none;
    }
    button.proto:hover{ background:rgba(255,255,255,0.06); border-color:rgba(255,255,255,0.10); color:#FFFFFF; transform:translateY(-1px); box-shadow:inset 0 1px 0 rgba(255,255,255,0.07), 0 6px 20px rgba(0,0,0,0.35); }
    button.proto:hover::before{ opacity:1; }
    button.proto:active{ transform:translateY(0) scale(0.99); }
    button.proto.active{ background:#FFFFFF; border-color:#FFFFFF; color:#0A0A0A; font-weight:650; box-shadow:0 6px 20px rgba(0,0,0,0.30), inset 0 1px 0 rgba(255,255,255,0.9); }
    button.proto.active:hover{ background:#F2F2F2; border-color:#F2F2F2; }
    
    .output{
      margin-top:20px;
      padding-top:20px;
      border-top:1px solid rgba(255,255,255,0.06);
      display:flex;
      gap:8px;
      align-items:center;
    }
    .field{
      flex:1;
      position:relative;
      display:flex;
      align-items:center;
    }
    input#config-output{
      width:100%;
      background:rgba(8,10,14,0.26);
      backdrop-filter:none;
      -webkit-backdrop-filter:none;
      border:1px solid rgba(255,255,255,0.09);
      color:#E8E8E8;
      padding:13px 14px;
      border-radius:11px;
      font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size:12px;
      line-height:1.4;
      outline:none;
      transition:border-color 0.2s ease, background 0.2s ease, box-shadow 0.2s ease;
      box-shadow:inset 0 1px 0 rgba(255,255,255,0.03);
    }
    input#config-output::placeholder{ color:#6A6A6A; }
    input#config-output:focus{ border-color:rgba(125,211,224,0.32); background:rgba(8,10,14,0.32); box-shadow:0 0 0 3px rgba(125,211,224,0.10); }
    .btn-copy{
      height:42px;
      padding:0 18px;
      background:rgba(242,242,242,0.95);
      backdrop-filter:none;
      color:#080808;
      border:1px solid rgba(255,255,255,0.9);
      border-radius:11px;
      font-size:13px;
      font-weight:650;
      letter-spacing:0.01em;
      cursor:pointer;
      white-space:nowrap;
      transition:all 0.2s ease;
      box-shadow:0 4px 16px rgba(0,0,0,0.25);
    }
    .btn-copy:hover{ background:#FFFFFF; transform:translateY(-1px); box-shadow:0 6px 20px rgba(0,0,0,0.3); }
    .btn-copy:active{ transform:scale(0.98); }
    .hint{
      margin-top:10px;
      font-size:11px;
      color:#F0F0F0;
      text-shadow:0 1px 6px rgba(0,0,0,0.45);
      line-height:1.5;
      letter-spacing:0.01em;
    }
    .wildcard{ margin-top:18px; padding-top:18px; border-top:1px solid rgba(255,255,255,0.06); }
    .wildcard-list{ display:flex; flex-wrap:wrap; gap:7px; margin-top:10px; }
    .chip{ display:inline-flex; align-items:center; padding:8px 13px; background:rgba(8,10,14,0.26); backdrop-filter:none; -webkit-backdrop-filter:none; border:1px solid rgba(255,255,255,0.09); border-radius:999px; font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size:13px; font-weight:500; color:#F0F0F0; letter-spacing:0.01em; box-shadow:inset 0 1px 0 rgba(255,255,255,0.04); transition:all 0.2s ease; cursor:pointer; }
    .chip:hover{ border-color:rgba(125,211,224,0.28); color:#FFFFFF; background:rgba(255,255,255,0.06); box-shadow:0 2px 12px rgba(30,90,138,0.18); transform:translateY(-1px); }
    .chip.active{ background:rgba(125,211,224,0.22); border-color:rgba(125,211,224,0.6); color:#FFF; }
    .footer{
      margin-top:16px;
      text-align:center;
    }
    .support-link{
      display:inline-flex;
      align-items:center;
      gap:8px;
      color:rgba(255,255,255,0.95);
      text-decoration:none;
      font-size:13px;
      font-weight:500;
      letter-spacing:0.04em;
      background:rgba(8,10,14,0.26);
      backdrop-filter:none;
      -webkit-backdrop-filter:none;
      border:1px solid rgba(255,255,255,0.09);
      padding:9px 16px;
      border-radius:999px;
      transition:all 0.22s ease;
      box-shadow:0 4px 16px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.05);
    }
    .support-link:hover{ color:#FFFFFF; background:rgba(255,255,255,0.07); border-color:rgba(125,211,224,0.28); box-shadow:0 6px 20px rgba(0,0,0,0.35), 0 0 14px rgba(125,211,224,0.16); transform:translateY(-1px); }
    @media (max-width:560px){
      body{ padding:28px 16px 24px; }
      .content{ padding:20px 18px 18px; }
      .grid-3{ grid-template-columns:1fr; }
      .output{ flex-direction:column; align-items:stretch; }
      .btn-copy{ width:100%; justify-content:center; }
    }
  </style>
</head>
<body>
  <div class="bg-image" aria-hidden="true"></div>
  <div class="bg-overlay" aria-hidden="true"></div>
  <div class="bg-orbs" aria-hidden="true"><div class="orb orb1"></div><div class="orb orb2"></div></div>
  <div class="shell" id="shell">
    <div class="panel">
      <div class="header"><div class="brand">ARGO TUNNEL</div></div>
      <div class="content">

        <!-- 1. CASCADING REGION & PROVIDER SELECTOR -->
        <div class="group reveal">
          <div class="group-head"><div class="group-line"></div><div class="eyebrow">Region & Provider</div></div>
          <div class="grid-2">
            <select id="sel-region" class="select-style" onchange="onRegionChange()">
              <option value="">⚡ Direct</option>
              ${Object.keys(regionMap).sort().map(cc => `
                <option value="${esc(cc)}">${flagOf(esc(cc))}</option>
              `).join('')}
            </select>

            <select id="sel-provider" class="select-style" onchange="onProviderChange()">
              <option value="">Semua Provider / Default</option>
            </select>
          </div>
        </div>

        <!-- 2. SECURITY MODE (TLS vs Non-TLS) -->
        <div class="group reveal">
          <div class="group-head"><div class="group-line"></div><div class="eyebrow">Security Port</div></div>
          <div class="grid-2">
            <button class="proto active" id="sec-tls" onclick="setSecurity('tls',this)">TLS (Port 443)</button>
            <button class="proto" id="sec-ntls" onclick="setSecurity('none',this)">Non-TLS (Port 80)</button>
          </div>
        </div>

        <!-- 3. BUG SNI -->
        <div class="group reveal">
          <div class="group-head"><div class="group-line"></div><div class="eyebrow">Bug SNI</div></div>
          <div class="grid-2">
            <button class="proto" onclick="generate('native','vless',this)">VLESS</button>
            <button class="proto" onclick="generate('native','trojan',this)">TROJAN</button>
          </div>
        </div>

        <!-- 4. BUG CDN -->
        <div class="group reveal">
          <div class="group-head"><div class="group-line"></div><div class="eyebrow">Bug CDN</div></div>
          <div class="grid-3">
            <button class="proto" onclick="generate('argo','vless',this)">VLESS</button>
            <button class="proto" onclick="generate('argo','vmess',this)">VMESS</button>
            <button class="proto" onclick="generate('argo','trojan',this)">TROJAN</button>
          </div>
        </div>

        <!-- 5. OUTPUT & INSTANT COPY (Identical to argo-node) -->
        <div class="output" style="justify-content:center">
          <input type="text" id="config-output" placeholder="Klik salah satu protokol di atas..." readonly />
          <button class="btn-copy" id="copy-btn" onclick="copyConfig()">Copy</button>
        </div>
        <div class="hint" id="hint" style="text-align:center"></div>

        <!-- 6. BUG SELECTOR -->
        <div class="group reveal">
          <div class="group-head"><div class="group-line"></div><div class="eyebrow">Bug Wildcard — CDN Supported</div></div>
          <select id="sel-bug" class="select-style" onchange="onBugChange()">
            <option value="">Default (Host Asli)</option>
            <option value="support.zoom.us">support.zoom.us</option>
            <option value="ava.game.naver.com">ava.game.naver.com</option>
            <option value="quiz.int.vidio.com">quiz.int.vidio.com</option>
            <option value="graph.instagram.com">graph.instagram.com</option>
          </select>
        </div>

      </div>
    </div>

    <!-- 7. FOOTER LINK TO ADMIN DASHBOARD -->
    <div class="footer">
      <a href="/admin" class="support-link">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75l-2.2-1.45c-.95-.63-.33-.98.21-1.55l.85-.85c.09-.09.17-.17.17-.34l-2.14-1.64c-.23-.18-.39-.28-.39-.56 0-.28.2-.43.5-.57l3.4-1.29c1.02-.42 1.69-.66 1.95-.84.26-.18.33-.42.33-.67a.9.9 0 0 0-.02-.2c-.05-.26-.26-.4-.52-.4-.9-.08-1.94.6-3.06 1.4-.42.3-.8.45-1.14.45-.5 0-1.1-.4-1.6-.9-.7-.7-.9-1.2-.3-1.6.6-.4 1.8-.5 2.9-1 1.1-.5 2.1-1 4.4-.9.4 0 .9.2 1.1.6.2.4.2 1 .1 1.8z" fill="currentColor"/></svg>
        Admin Dashboard & Scanner
      </a>
    </div>
  </div>

  <script>
    const ALL_NODES = ${JSON.stringify(nodes)};
    let activeBtn = null;
    let currentSecurity = 'tls';
    let currentBug = '';
    let currentNetwork = 'argo';
    let currentProtocol = 'vless';

    function onRegionChange() {
      const cc = document.getElementById('sel-region').value;
      const provEl = document.getElementById('sel-provider');
      provEl.innerHTML = '<option value="">Semua Provider / Default</option>';
      if (!cc) {
        if (activeBtn) generate(currentNetwork, currentProtocol, activeBtn);
        return;
      }
      const filtered = ALL_NODES.filter(n => (n.flag || '').toUpperCase() === cc);
      filtered.forEach(n => {
        const opt = document.createElement('option');
        opt.value = n.id;
        opt.textContent = n.name || n.id;
        provEl.appendChild(opt);
      });
      if (activeBtn) generate(currentNetwork, currentProtocol, activeBtn);
    }

    function onProviderChange() {
      if (activeBtn) generate(currentNetwork, currentProtocol, activeBtn);
    }

    function setSecurity(sec, el) {
      currentSecurity = sec;
      document.querySelectorAll('#sec-tls, #sec-ntls').forEach(b => b.classList.remove('active'));
      el.classList.add('active');
      if (activeBtn) generate(currentNetwork, currentProtocol, activeBtn);
    }

    function onBugChange() {
      currentBug = document.getElementById('sel-bug').value;
      if (activeBtn) generate(currentNetwork, currentProtocol, activeBtn);
    }

    async function generate(network, protocol, el) {
      currentNetwork = network;
      currentProtocol = protocol;
      const outputEl = document.getElementById('config-output');
      const hint = document.getElementById('hint');
      if (activeBtn) activeBtn.classList.remove('active');
      if (el) { el.classList.add('active'); activeBtn = el; }
      outputEl.value = 'Loading…';
      hint.textContent = 'Fetching configuration…';
      hint.style.display = 'block';
      document.getElementById('copy-btn').textContent = 'Copy';

      const regionCc = document.getElementById('sel-region').value;
      const specificId = document.getElementById('sel-provider').value;
      let chosenNodeId = specificId;
      if (!chosenNodeId && regionCc) {
        const first = ALL_NODES.find(n => (n.flag || '').toUpperCase() === regionCc);
        if (first) chosenNodeId = first.id;
      }

      const params = new URLSearchParams({
        node: chosenNodeId || '',
        bug: currentBug,
        sec: currentSecurity
      });

      try {
        const res = await fetch('/api/config?' + params.toString());
        const data = await res.json();
        const val = data[network][protocol];
        outputEl.value = val || '';
        if (val && val.startsWith('Menunggu')) hint.textContent = 'Tunnel not ready yet. Try again in a few seconds.';
        else hint.textContent = '';
        hint.style.display = hint.textContent ? 'block' : 'none';
      } catch (e) {
        outputEl.value = '';
        hint.textContent = 'Failed to load configuration.';
      }
    }

    // Exact Smooth Eased 3D Tilt from argo-node (LERP interpolation)
    (function(){
      const shell = document.getElementById('shell');
      if(!shell) return;
      let tx=0, ty=0, cx=0, cy=0, running=false;
      function loop(){
        cx += (tx-cx)*0.07;
        cy += (ty-cy)*0.07;
        shell.style.transform = 'rotateY(' + cx.toFixed(3) + 'deg) rotateX(' + cy.toFixed(3) + 'deg)';
        if(Math.abs(tx-cx) > 0.002 || Math.abs(ty-cy) > 0.002){
          requestAnimationFrame(loop);
        } else { running = false; }
      }
      window.addEventListener('mousemove', (e)=>{
        if(window.matchMedia('(pointer: coarse)').matches) return;
        tx = (e.clientX/window.innerWidth - 0.5) * 3.2;
        ty = -(e.clientY/window.innerHeight - 0.5) * 2.6;
        if(!running){ running = true; requestAnimationFrame(loop); }
      }, {passive:true});
    })();

    // Exact Staggered Reveal animations from argo-node
    (function(){
      const io = new IntersectionObserver((entries)=>{
        entries.forEach(en=>{ if(en.isIntersecting) en.target.classList.add('in'); });
      }, {threshold:0.12});
      document.querySelectorAll('.group.reveal').forEach(el=> io.observe(el));
      requestAnimationFrame(()=> document.querySelectorAll('.group.reveal').forEach((el,i)=> setTimeout(()=> el.classList.add('in'), 120*i)));
    })();

    function copyConfig(){
      const el = document.getElementById('config-output');
      const hint = document.getElementById('hint');
      if(!el.value || el.value === 'Loading…') return;
      navigator.clipboard.writeText(el.value).then(()=>{
        const btn = document.getElementById('copy-btn');
        btn.textContent = 'Copied';
        if(hint){ hint.textContent = 'Copied to clipboard.'; hint.style.display='block'; }
        setTimeout(()=>{ if(btn.textContent==='Copied'){ btn.textContent='Copy'; if(hint){ hint.textContent=''; hint.style.display='none'; } } }, 1800);
      }).catch(()=>{
        if(el.select) el.select();
        try{ document.execCommand('copy'); }catch(e){}
        const btn = document.getElementById('copy-btn');
        btn.textContent = 'Copied';
        setTimeout(()=> btn.textContent='Copy', 1500);
      });
    }
  </script>
</body>
</html>
`;
}

function adminPage({ host = '' } = {}) {
  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <title>Admin Dashboard & Scanner — Loket</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body{background:#0a0c10;color:#e8e8e8;font-family:sans-serif;padding:24px}
    .card{background:#12151c;border:1px solid #282e3d;border-radius:12px;padding:20px;max-width:800px;margin:0 auto 20px}
    h2{margin-bottom:12px;color:#fff}
    textarea{width:100%;height:150px;background:#0d0f14;border:1px solid #333;color:#fff;border-radius:8px;padding:10px;font-family:monospace}
    button{background:#3b82f6;color:#fff;border:none;padding:10px 20px;border-radius:8px;cursor:pointer;font-weight:bold;margin-top:10px}
    button:hover{background:#2563eb}
    .status{margin-top:10px;font-size:13px;color:#94a3b8}
  </style>
</head>
<body>
  <div class="card">
    <h2>⚡ Proxy Scanner & Node Importer</h2>
    <p style="font-size:13px;color:#94a3b8;margin-bottom:12px">Paste proxy raw / ProxyCheck report atau upload file txt untuk update multi-node.</p>
    <textarea id="proxy-input" placeholder="Paste proxy report di sini..."></textarea>
    <div>
      <input type="file" id="file-input" accept=".txt" style="margin-top:10px" />
    </div>
    <button onclick="startScan()">⚡ Start Scan & Hot-Reload</button>
    <div id="scan-status" class="status"></div>
  </div>

  <script>
    document.getElementById('file-input').addEventListener('change', function(e) {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function(evt) {
        document.getElementById('proxy-input').value = evt.target.result;
      };
      reader.readAsText(file);
    });

    async function startScan() {
      const text = document.getElementById('proxy-input').value;
      const status = document.getElementById('scan-status');
      if (!text.trim()) return alert('Paste proxy report dulu!');
      status.textContent = 'Scanning and verifying nodes... mohon tunggu...';
      try {
        const res = await fetch('/api/admin/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ raw: text, autoSave: true })
        });
        const d = await res.json();
        status.textContent = 'Selesai! Live nodes: ' + d.live + ' / ' + d.total + '. Volume updated!';
      } catch (e) {
        status.textContent = 'Error: ' + e.message;
      }
    }
  </script>
</body>
</html>`;
}

module.exports = { publicPage, adminPage };
