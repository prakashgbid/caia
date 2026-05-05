/**
 * Static HTML for the status dashboard.
 * Inlined as a string constant so the dashboard ships as a single file (no
 * separate `public/` directory to plumb through the build).
 *
 * Loaded at GET /. Issues an XHR to /api/status every 5s and re-renders.
 */

export const DASHBOARD_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Local Preview — Status</title>
<style>
  :root {
    --bg: #0e1116;
    --card: #161b22;
    --line: #30363d;
    --text: #c9d1d9;
    --muted: #8b949e;
    --ok: #3fb950;
    --warn: #d29922;
    --bad: #f85149;
    --link: #58a6ff;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 24px;
    font: 14px -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif;
    background: var(--bg); color: var(--text);
  }
  h1 { font-size: 18px; margin: 0 0 16px; font-weight: 600; }
  table { border-collapse: collapse; width: 100%; max-width: 1100px; }
  thead th {
    text-align: left; padding: 8px 12px; font-weight: 600;
    color: var(--muted); border-bottom: 1px solid var(--line);
    font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em;
  }
  tbody td {
    padding: 12px; border-bottom: 1px solid var(--line);
    vertical-align: top;
  }
  tbody tr:hover { background: #1d242c; }
  .name { font-weight: 600; }
  .url a { color: var(--link); text-decoration: none; }
  .url a:hover { text-decoration: underline; }
  .sha { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 12px; color: var(--muted); }
  .pill {
    display: inline-block; padding: 2px 8px; border-radius: 999px;
    font-size: 11px; font-weight: 600; text-transform: uppercase;
  }
  .pill-ok { background: rgba(63,185,80,.15); color: var(--ok); }
  .pill-warn { background: rgba(210,153,34,.15); color: var(--warn); }
  .pill-bad { background: rgba(248,81,73,.15); color: var(--bad); }
  .pill-muted { background: rgba(139,148,158,.15); color: var(--muted); }
  .actions button {
    background: #21262d; color: var(--text); border: 1px solid var(--line);
    border-radius: 6px; padding: 4px 10px; font-size: 12px; cursor: pointer;
    margin-right: 4px;
  }
  .actions button:hover { background: #2a3038; }
  .actions button:disabled { opacity: 0.5; cursor: not-allowed; }
  .footer { color: var(--muted); margin-top: 16px; font-size: 12px; }
  .err { color: var(--bad); }
</style>
</head>
<body>
  <h1>Local Preview · Status Dashboard</h1>
  <table>
    <thead>
      <tr>
        <th>Site</th>
        <th>URL</th>
        <th>Current SHA</th>
        <th>Last Deploy</th>
        <th>Health</th>
        <th>Actions</th>
      </tr>
    </thead>
    <tbody id="rows"></tbody>
  </table>
  <div class="footer" id="footer">Loading…</div>

<script>
(function() {
  function shortSha(s) { return s ? String(s).slice(0, 7) : '—'; }
  function timeAgo(iso) {
    if (!iso) return '—';
    var d = new Date(iso); if (isNaN(d.getTime())) return iso;
    var diff = Math.floor((Date.now() - d.getTime()) / 1000);
    if (diff < 60) return diff + 's ago';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return Math.floor(diff / 86400) + 'd ago';
  }
  function statusPill(s) {
    if (s === 'success') return '<span class="pill pill-ok">success</span>';
    if (s === 'noop') return '<span class="pill pill-muted">noop</span>';
    if (!s) return '<span class="pill pill-muted">never</span>';
    return '<span class="pill pill-bad">' + s + '</span>';
  }
  function healthPill(s) {
    if (s === 'ok') return '<span class="pill pill-ok">ok</span>';
    if (s === 'failed') return '<span class="pill pill-bad">failed</span>';
    return '<span class="pill pill-muted">unknown</span>';
  }
  async function refresh() {
    try {
      var res = await fetch('/api/status');
      var data = await res.json();
      var rows = document.getElementById('rows');
      rows.innerHTML = data.sites.map(function(s) {
        return '<tr>' +
          '<td class="name">' + s.name + '</td>' +
          '<td class="url"><a href="' + s.url + '" target="_blank">' + s.url + '</a></td>' +
          '<td class="sha">' + shortSha(s.current_sha) + '</td>' +
          '<td>' + statusPill(s.last_deploy_status) + ' <span class="sha">' + timeAgo(s.last_deploy_at) + '</span></td>' +
          '<td>' + healthPill(s.last_health_check_status) + '</td>' +
          '<td class="actions">' +
            '<button data-site="' + s.name + '" data-action="redeploy">Redeploy</button>' +
            '<button data-site="' + s.name + '" data-action="rollback">Rollback</button>' +
          '</td>' +
        '</tr>';
      }).join('');
      document.getElementById('footer').textContent = 'Updated ' + new Date().toLocaleTimeString() +
        ' · ' + data.sites.length + ' sites · refresh every 5s';
    } catch (e) {
      document.getElementById('footer').innerHTML = '<span class="err">Failed to load status: ' + e + '</span>';
    }
  }
  document.body.addEventListener('click', async function(e) {
    var t = e.target;
    if (!(t instanceof HTMLButtonElement)) return;
    var action = t.getAttribute('data-action');
    var site = t.getAttribute('data-site');
    if (!action || !site) return;
    t.disabled = true;
    try {
      var url = '/api/' + action + '/' + encodeURIComponent(site);
      var res = await fetch(url, { method: 'POST' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
    } catch (err) {
      alert('Action failed: ' + err);
    }
    t.disabled = false;
    refresh();
  });
  refresh();
  setInterval(refresh, 5000);
})();
</script>
</body>
</html>`;
