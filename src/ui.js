'use strict';

function esc(s = '') {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function publicPage({ host = '', nodes = [] } = {}) {
  return `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Loket VPN | Catalog</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
    <style>
        :root { --bg: #0a0a0c; --fg: #fafafa; --card: rgba(22,22,26,0.7); --card-border: rgba(255,255,255,0.08); }
        body { background-color: var(--bg); color: var(--fg); font-family: -apple-system, sans-serif; }
        .ui-card { background: var(--card); backdrop-filter: blur(20px); border: 1px solid var(--card-border); border-radius: 16px; overflow: hidden; }
        .vpn-row { display: flex; flex-direction: row; align-items: stretch; border-bottom: 1px solid var(--card-border); transition: background 0.15s; }
        .vpn-row:hover { background: rgba(255,255,255,0.03); }
        .vpn-info { display: flex; align-items: center; gap: 14px; flex: 1; padding: 12px 18px; min-width: 0; }
        .vpn-copy { width: 56px; flex: 0 0 56px; display: flex; align-items: center; justify-content: center; cursor: pointer; border: none; background: transparent; color: #fff; transition: all .2s ease; border-left: 1px solid var(--card-border); }
        .vpn-copy:hover { background: #fff; color: #000; }
        .nb-skel { display: block; width: 50px; height: 10px; border-radius: 4px; background: currentColor; opacity: .18; animation: pulse 1.5s infinite; }
        @keyframes pulse { 0%, 100% { opacity: .18; } 50% { opacity: .06; } }
        .ui-select { background: rgba(255,255,255,0.06); border: 1px solid var(--card-border); border-radius: 10px; padding: 8px 12px; color: white; width: 100%; font-size: 13px; outline: none; }
        .ui-select:focus { border-color: rgba(255,255,255,0.25); }
    </style>
</head>
<body class="p-4 md:p-8">
    <main class="max-w-4xl mx-auto">
        <header class="mb-6 flex items-center justify-between">
            <div>
                <h1 class="text-2xl font-black tracking-tight flex items-center gap-2">
                    <span class="bg-white text-black px-2 py-0.5 rounded text-lg font-mono">LOKET</span>
                    <span>VPN</span>
                </h1>
                <p class="text-xs text-gray-500 font-mono mt-0.5">${nodes.length} Verified Fast Proxies</p>
            </div>
            <a href="/admin" class="text-xs font-semibold px-3 py-1.5 rounded-lg border border-white/10 hover:bg-white/10 transition">Admin ⚙️</a>
        </header>

        <div class="ui-card p-5 mb-6">
            <div class="grid grid-cols-2 md:grid-cols-5 gap-3">
                <div>
                    <label class="text-[10px] uppercase font-bold text-gray-400 mb-1 block">Protocol</label>
                    <select id="f-proto" onchange="render()" class="ui-select">
                        <option value="vless">VLESS</option>
                        <option value="vmess">VMESS</option>
                        <option value="trojan">TROJAN</option>
                    </select>
                </div>
                <div>
                    <label class="text-[10px] uppercase font-bold text-gray-400 mb-1 block">Security</label>
                    <select id="f-sec" onchange="render()" class="ui-select">
                        <option value="tls">TLS (443)</option>
                        <option value="none">Non-TLS (80)</option>
                    </select>
                </div>
                <div>
                    <label class="text-[10px] uppercase font-bold text-gray-400 mb-1 block">Bug / SNI</label>
                    <select id="f-bug" onchange="render()" class="ui-select">
                        <option value="">Default Host</option>
                        <option value="support.zoom.us">Zoom</option>
                        <option value="ava.game.naver.com">Naver</option>
                        <option value="quiz.int.vidio.com">Vidio</option>
                        <option value="graph.instagram.com">Instagram</option>
                    </select>
                </div>
                <div>
                    <label class="text-[10px] uppercase font-bold text-gray-400 mb-1 block">Location</label>
                    <select id="f-cc" onchange="render()" class="ui-select">
                        <option value="ALL">All Countries</option>
                    </select>
                </div>
                <div class="col-span-2 md:col-span-1">
                    <label class="text-[10px] uppercase font-bold text-gray-400 mb-1 block">Search</label>
                    <input type="text" id="f-search" oninput="render()" class="ui-select" placeholder="Filter IP/Name...">
                </div>
            </div>
        </div>

        <div id="node-list" class="ui-card divide-y divide-white/5"></div>
        <div id="pagination" class="mt-4 flex justify-between items-center text-xs font-semibold text-gray-400 px-2"></div>
    </main>

    <div id="toast" class="fixed bottom-6 right-6 bg-white text-black px-4 py-2 rounded-xl text-xs font-bold shadow-2xl transition transform translate-y-20 opacity-0 duration-200 pointer-events-none">
        Copied to clipboard!
    </div>

    <script>
        const nodes = ${JSON.stringify(nodes)};
        let page = 0;

        function getFlag(cc) {
            return (cc || 'XX').replace(/./g, c => String.fromCodePoint(127397 + c.charCodeAt(0)));
        }

        function render() {
            const proto = document.getElementById('f-proto').value;
            const sec = document.getElementById('f-sec').value;
            const bug = document.getElementById('f-bug').value;
            const cc = document.getElementById('f-cc').value;
            const search = document.getElementById('f-search').value.toLowerCase();

            const filtered = nodes.filter(n => {
                const matchCc = (cc === 'ALL' || (n.cc || n.flag) === cc);
                const proxyStr = n.proxy || '';
                const matchSearch = (n.name || '').toLowerCase().includes(search) || proxyStr.includes(search);
                return matchCc && matchSearch;
            });

            const totalPages = Math.ceil(filtered.length / 20) || 1;
            if (page >= totalPages) page = 0;
            const slice = filtered.slice(page * 20, (page + 1) * 20);

            const container = document.getElementById('node-list');
            if (slice.length === 0) {
                container.innerHTML = '<div class="p-8 text-center text-gray-500 text-sm">No proxy nodes found matching filter.</div>';
            } else {
                container.innerHTML = slice.map((n, i) => {
                    const hostPort = (n.proxy || '').split('@')[1] || '';
                    const parts = hostPort.split(':');
                    const ip = parts[0] || '127.0.0.1';
                    const port = parts[1] || '80';
                    const idx = page * 20 + i;
                    return \`
                        <div class="vpn-row">
                            <div class="vpn-info">
                                <span class="text-2xl">\${getFlag(n.flag || n.cc)}</span>
                                <div class="flex-1 min-w-0">
                                    <div class="text-[13px] font-mono font-semibold truncate text-white">\${ip}</div>
                                    <div class="text-[10px] text-gray-400 uppercase tracking-wider truncate">\${n.name || n.id}</div>
                                    <div id="status-\${idx}" class="text-[10px] font-bold mt-0.5" data-ip="\${ip}" data-port="\${port}">
                                        <span class="nb-skel"></span>
                                    </div>
                                </div>
                            </div>
                            <button onclick="copyConfig('\${n.id}', '\${n.name || n.id}')" title="Copy Configuration" class="vpn-copy">
                                <i class="fas fa-copy"></i>
                            </button>
                        </div>\`;
                }).join('');
            }

            document.getElementById('pagination').innerHTML = \`
                <button onclick="chg(-1)" class="px-3 py-1.5 rounded bg-white/5 hover:bg-white/10 transition \${page === 0 ? 'opacity-30 cursor-not-allowed' : ''}">PREV</button>
                <span>Page \${page + 1} of \${totalPages} (\${filtered.length} nodes)</span>
                <button onclick="chg(1)" class="px-3 py-1.5 rounded bg-white/5 hover:bg-white/10 transition \${page >= totalPages - 1 ? 'opacity-30 cursor-not-allowed' : ''}">NEXT</button>
            \`;
            
            slice.forEach((n, i) => {
                const hostPort = (n.proxy || '').split('@')[1] || '';
                const parts = hostPort.split(':');
                const idx = page * 20 + i;
                setTimeout(() => checkStatus(idx, parts[0], parts[1]), i * 80);
            });
        }

        function chg(d) {
            page = Math.max(0, page + d);
            render();
        }

        async function checkStatus(id, ip, port) {
            const el = document.getElementById('status-' + id);
            if (!el) return;
            try {
                const r = await fetch('/api/check-proxy?ip=' + ip + '&port=' + port).then(j => j.json());
                if (r.status === 'Active') {
                    const color = r.ping_ms < 300 ? 'text-emerald-400' : 'text-amber-400';
                    el.innerHTML = \`<span class="\${color}">● \${r.ping_ms} ms</span>\`;
                } else {
                    el.innerHTML = '<span class="text-red-400">● OFFLINE</span>';
                }
            } catch(e) {
                el.innerHTML = '<span class="text-gray-500">● TIMEOUT</span>';
            }
        }

        async function copyConfig(nodeId, name) {
            const proto = document.getElementById('f-proto').value;
            const sec = document.getElementById('f-sec').value;
            const bug = document.getElementById('f-bug').value;
            try {
                const res = await fetch('/api/config?node=' + nodeId + '&sec=' + sec + '&bug=' + encodeURIComponent(bug)).then(j => j.json());
                const cfg = (res.argo && res.argo[proto]) || (res.native && res.native[proto]) || '';
                if (!cfg) throw new Error('No config generated');
                await navigator.clipboard.writeText(cfg);
                showToast('Copied: ' + name);
            } catch (err) {
                alert('Failed to generate config: ' + err.message);
            }
        }

        function showToast(msg) {
            const t = document.getElementById('toast');
            t.textContent = msg;
            t.classList.remove('translate-y-20', 'opacity-0');
            setTimeout(() => t.classList.add('translate-y-20', 'opacity-0'), 2000);
        }

        // Populate countries dropdown
        const ccOpt = document.getElementById('f-cc');
        const ccs = [...new Set(nodes.map(n => n.cc || n.flag).filter(Boolean))].sort();
        ccs.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c;
            opt.textContent = getFlag(c) + ' ' + c;
            ccOpt.appendChild(opt);
        });

        render();
    </script>
</body>
</html>`;
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
