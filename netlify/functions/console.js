const crypto = require('crypto');

const SESSION_COOKIE = 'postopz_console_access';
const securityHeaders = {
  'Cache-Control': 'private, no-store, max-age=0',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-Robots-Tag': 'noindex, nofollow, noarchive'
};

function textResponse(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: { ...securityHeaders, 'Content-Type': 'text/plain; charset=utf-8', ...headers },
    body
  };
}

function unauthorized() {
  return textResponse(401, 'Authentication is required.', {
    'WWW-Authenticate': 'Basic realm="PostOpz Console", charset="UTF-8"'
  });
}

function credentialsMatch(value, expected) {
  const received = Buffer.from(value, 'utf8');
  const required = Buffer.from(expected, 'utf8');
  return received.length === required.length && crypto.timingSafeEqual(received, required);
}

function formToken(accessToken, privateGatePassword) {
  return crypto.createHmac('sha256', privateGatePassword).update(accessToken).digest('base64url');
}

function getAuthorization(headers) {
  return headers.authorization || headers.Authorization || '';
}

function readCookies(headers) {
  return (headers.cookie || headers.Cookie || '').split(';').reduce((cookies, part) => {
    const separator = part.indexOf('=');
    if (separator < 0) return cookies;
    cookies[part.slice(0, separator).trim()] = decodeURIComponent(part.slice(separator + 1).trim());
    return cookies;
  }, {});
}

function parseForm(event) {
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : (event.body || '');
  return Object.fromEntries(new URLSearchParams(raw));
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[character]));
}

function supabaseConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  return url && key ? { url: url.replace(/\/$/, ''), key } : null;
}

async function supabaseRequest(config, path, options = {}) {
  const headers = {
    apikey: config.key,
    ...(options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {}),
    ...(options.headers || {})
  };
  const response = await fetch(`${config.url}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body
  });
  const contentType = response.headers.get('content-type') || '';
  const body = await response.text();
  let data = null;
  if (contentType.includes('application/json') && body) {
    try { data = JSON.parse(body); } catch (_) { data = null; }
  }
  return { ok: response.ok, status: response.status, data };
}

async function signIn(config, email, password) {
  try {
    const result = await supabaseRequest(config, '/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    return result.ok && result.data && result.data.access_token ? result.data : null;
  } catch (_) {
    return null;
  }
}

async function currentUser(config, accessToken) {
  if (!accessToken) return null;
  try {
    const result = await supabaseRequest(config, '/auth/v1/user', { accessToken });
    return result.ok && result.data && result.data.id ? result.data : null;
  } catch (_) {
    return null;
  }
}

async function dashboardData(config, accessToken) {
  try {
    const requests = await Promise.all([
      supabaseRequest(config, '/rest/v1/organizations?select=id,name,slug&order=name', { accessToken }),
      supabaseRequest(config, '/rest/v1/productions?select=id,name,status&order=updated_at.desc&limit=8', { accessToken }),
      supabaseRequest(config, '/rest/v1/integration_connections?select=id,provider,display_name,status&order=provider', { accessToken }),
      supabaseRequest(config, '/rest/v1/activity_items?select=id,title,detail,severity,occurred_at&order=occurred_at.desc&limit=8', { accessToken }),
      supabaseRequest(config, '/rest/v1/archive_recommendations?select=id,status,estimated_bytes,confidence&order=created_at.desc&limit=8', { accessToken }),
      supabaseRequest(config, '/rest/v1/organization_members?select=organization_id,role', { accessToken })
    ]);

    return {
      organizations: requests[0].ok ? requests[0].data : [],
      productions: requests[1].ok ? requests[1].data : [],
      integrations: requests[2].ok ? requests[2].data : [],
      activity: requests[3].ok ? requests[3].data : [],
      recommendations: requests[4].ok ? requests[4].data : [],
      memberships: requests[5].ok ? requests[5].data : []
    };
  } catch (_) {
    return { organizations: [], productions: [], integrations: [], activity: [], recommendations: [], memberships: [] };
  }
}

function operatorOrganizations(dashboard) {
  const roles = new Map((dashboard.memberships || []).map((member) => [member.organization_id, member.role]));
  return (dashboard.organizations || []).filter((organization) => ['operator', 'admin'].includes(roles.get(organization.id)));
}

async function registerProduction(config, accessToken, dashboard, form) {
  const organizationId = String(form.organization_id || '');
  const name = String(form.name || '').trim();
  const status = String(form.status || 'active');
  const allowedStatuses = ['planned', 'active', 'delivered', 'archived', 'on_hold'];
  if (!operatorOrganizations(dashboard).some((organization) => organization.id === organizationId)) return { ok: false, message: 'Your role cannot add a production in that workspace.' };
  if (name.length < 2 || name.length > 240 || !allowedStatuses.includes(status)) return { ok: false, message: 'Enter a production name and valid status.' };
  try {
    const result = await supabaseRequest(config, '/rest/v1/productions', {
      method: 'POST',
      accessToken,
      headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ organization_id: organizationId, name, status })
    });
    return result.ok ? { ok: true } : { ok: false, message: 'Console could not save that production.' };
  } catch (_) {
    return { ok: false, message: 'Console could not reach the workspace database.' };
  }
}

async function registerIntegration(config, accessToken, dashboard, form) {
  const organizationId = String(form.organization_id || '');
  const provider = String(form.provider || '');
  const displayName = String(form.display_name || '').trim();
  const providers = ['iconik', 'google_drive', 'frame_io', 'masv', 'slack', 'aws_s3', 'backblaze_b2', 'wasabi', 'lucidlink', 'avid_media_composer', 'adobe_premiere_pro', 'davinci_resolve'];
  if (!operatorOrganizations(dashboard).some((organization) => organization.id === organizationId)) return { ok: false, message: 'Your role cannot register an integration in that workspace.' };
  if (!providers.includes(provider) || displayName.length < 2 || displayName.length > 120) return { ok: false, message: 'Choose a provider and give the connection a short name.' };
  try {
    const result = await supabaseRequest(config, '/rest/v1/integration_connections', {
      method: 'POST',
      accessToken,
      headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ organization_id: organizationId, provider, display_name: displayName, status: 'pending' })
    });
    return result.ok ? { ok: true } : { ok: false, message: 'Console could not register that connection.' };
  } catch (_) {
    return { ok: false, message: 'Console could not reach the workspace database.' };
  }
}

function setupPanel(dashboard, notice = '', requestToken = '') {
  const operatorWorkspaces = operatorOrganizations(dashboard);
  if (!operatorWorkspaces.length) return '';
  const workspaceOptions = operatorWorkspaces.map((organization) => `<option value="${escapeHtml(organization.id)}">${escapeHtml(organization.name)}</option>`).join('');
  const productionList = dashboard.productions.length
    ? `<ul class="compact-list">${dashboard.productions.map((production) => `<li><b>${escapeHtml(production.name)}</b><span>${escapeHtml(production.status)}</span></li>`).join('')}</ul>`
    : '<p class="quiet">No productions have been registered.</p>';
  const integrationList = dashboard.integrations.length
    ? `<ul class="compact-list">${dashboard.integrations.map((connection) => `<li><b>${escapeHtml(connection.provider.replaceAll('_', ' '))}</b><span>${escapeHtml(connection.status)}</span></li>`).join('')}</ul>`
    : '<p class="quiet">No provider connections have been registered.</p>';
  const frameIoConnect = dashboard.integrations.some((connection) => connection.provider === 'frame_io') ? '<p class="quiet"><a class="connect-link" href="/console/frameio/connect">Connect Frame.io with Adobe</a></p>' : '';
  const googleDriveConnect = dashboard.integrations.some((connection) => connection.provider === 'google_drive') ? '<p class="quiet"><a class="connect-link" href="/console/google/connect">Connect Google Drive / Docs</a></p>' : '';
  return `<section class="setup-grid"><article class="panel"><h2>Register a production</h2><p class="subhead">Metadata only. This does not create a project in an external system.</p><form class="setup-form" method="post" action="/console"><input type="hidden" name="action" value="register_production"><input type="hidden" name="form_token" value="${escapeHtml(requestToken)}"><label>Workspace<select name="organization_id" required>${workspaceOptions}</select></label><label>Production name<input name="name" maxlength="240" placeholder="Example: Strongman — Episode 104" required></label><label>Status<select name="status"><option value="active">Active</option><option value="planned">Planned</option><option value="delivered">Delivered</option><option value="on_hold">On hold</option><option value="archived">Archived</option></select></label><button type="submit">Add production</button></form>${productionList}</article><article class="panel"><h2>Register a read-only connection</h2><p class="subhead">Creates a pending setup record only. Do not enter tokens, passwords, bucket keys, or secrets here.</p><form class="setup-form" method="post" action="/console"><input type="hidden" name="action" value="register_integration"><input type="hidden" name="form_token" value="${escapeHtml(requestToken)}"><label>Workspace<select name="organization_id" required>${workspaceOptions}</select></label><label>Provider<select name="provider" required><option value="iconik">iconik</option><option value="google_drive">Google Drive / Docs</option><option value="frame_io">Frame.io</option><option value="masv">MASV</option><option value="slack">Slack</option><option value="aws_s3">AWS S3</option><option value="backblaze_b2">Backblaze B2</option><option value="wasabi">Wasabi</option><option value="lucidlink">LucidLink</option><option value="avid_media_composer">Avid Media Composer</option><option value="adobe_premiere_pro">Adobe Premiere Pro</option><option value="davinci_resolve">DaVinci Resolve</option></select></label><label>Connection name<input name="display_name" maxlength="120" placeholder="Example: Victory Road S3" required></label><button type="submit">Register pending connection</button></form>${integrationList}${googleDriveConnect}${frameIoConnect}</article></section>${notice ? `<p class="form-notice">${escapeHtml(notice)}</p>` : ''}`;
}

function loginPage(notice = '') {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow, noarchive"><title>PostOpz Console — Sign in</title><style>
  :root{color-scheme:dark;--bg:#05070b;--panel:#111827;--line:rgba(255,255,255,.12);--text:#f7f9fe;--muted:#a7afbe;--cyan:#00d9ff;--blue:#1976ff;--danger:#ff8d8d}*{box-sizing:border-box}body{margin:0;min-width:320px;min-height:100vh;display:grid;place-items:center;background:radial-gradient(circle at 84% 0,rgba(25,118,255,.2),transparent 30rem),var(--bg);color:var(--text);font:15px/1.5 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.card{width:min(440px,calc(100% - 32px));padding:32px;border:1px solid var(--line);border-radius:20px;background:linear-gradient(180deg,rgba(23,31,47,.96),rgba(10,13,20,.98));box-shadow:0 24px 80px rgba(0,0,0,.35)}.brand{display:flex;align-items:center;gap:11px;font-weight:800}.mark{width:30px;height:30px;display:grid;place-items:center;border-radius:9px;background:linear-gradient(135deg,var(--blue),#7c3cff);font-size:.76rem}.badge{margin-left:auto;padding:4px 8px;border:1px solid rgba(0,217,255,.4);border-radius:999px;color:var(--cyan);font-size:.67rem;font-weight:800;letter-spacing:.08em}h1{margin:30px 0 8px;font-size:1.8rem;letter-spacing:-.04em}p{color:var(--muted)}label{display:block;margin:18px 0 6px;font-size:.84rem;font-weight:700}input{width:100%;border:1px solid var(--line);border-radius:10px;padding:12px;background:#090d15;color:var(--text);font:inherit}button{width:100%;margin-top:24px;padding:12px;border:0;border-radius:10px;background:linear-gradient(135deg,var(--blue),#7c3cff);color:white;font:700 15px inherit;cursor:pointer}.notice{margin:16px 0 0;padding:10px 12px;border:1px solid rgba(255,141,141,.35);border-radius:10px;background:rgba(255,141,141,.08);color:var(--danger);font-size:.88rem}.foot{margin-top:22px;font-size:.8rem}.foot b{color:var(--cyan)}</style></head>
<body><main class="card"><div class="brand"><span class="mark">PZ</span><span>PostOpz Console</span><span class="badge">INTERNAL ALPHA</span></div><h1>Operator sign in</h1><p>Use your Console account. This is a second, organization-level check behind the private access gate.</p><form method="post" action="/console"><input type="hidden" name="action" value="sign_in"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="email" required><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required><button type="submit">Sign in to Console</button></form>${notice ? `<p class="notice">${escapeHtml(notice)}</p>` : ''}<p class="foot"><b>Access is invite-only.</b> Ask a Console administrator to create your account and workspace role.</p></main></body></html>`;
}

function dashboardPage(user, dashboard, notice = '', requestToken = '') {
  const healthy = dashboard.integrations.filter((item) => item.status === 'healthy').length;
  const ready = dashboard.recommendations.filter((item) => item.status === 'ready_for_review').length;
  const activity = dashboard.activity.length
    ? dashboard.activity.map((item) => `<li><b>${escapeHtml(item.title)}</b><span>${escapeHtml(item.detail || item.severity)} · ${new Date(item.occurred_at).toLocaleString()}</span></li>`).join('')
    : '<div class="empty"><strong>No operational events yet</strong>Connect a read-only provider after setup is complete.</div>';
  const workspaceMessage = dashboard.organizations.length
    ? escapeHtml(dashboard.organizations.map((organization) => organization.name).join(', '))
    : 'No workspace is assigned to this account yet.';

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow, noarchive"><title>PostOpz Console — Internal Alpha</title><style>
  :root{color-scheme:dark;--bg:#05070b;--panel:#111827;--line:rgba(255,255,255,.1);--text:#f7f9fe;--muted:#a7afbe;--cyan:#00d9ff;--blue:#1976ff;--green:#59ffb2;--amber:#ffbf4a}*{box-sizing:border-box}body{margin:0;min-width:320px;background:radial-gradient(circle at 84% 0,rgba(25,118,255,.18),transparent 30rem),var(--bg);color:var(--text);font:15px/1.55 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.shell{width:min(1440px,calc(100% - 40px));margin:0 auto;padding:28px 0 54px}header{display:flex;align-items:center;justify-content:space-between;gap:20px;padding-bottom:26px;border-bottom:1px solid var(--line)}.brand{display:flex;align-items:center;gap:12px;font-weight:800;font-size:1.16rem}.mark{width:31px;height:31px;border-radius:9px;display:grid;place-items:center;background:linear-gradient(135deg,var(--blue),#7c3cff);font-size:.8rem}.badge{padding:5px 9px;border:1px solid rgba(0,217,255,.4);border-radius:999px;color:var(--cyan);background:rgba(0,217,255,.08);font-size:.7rem;font-weight:800;letter-spacing:.08em}.account{display:flex;align-items:center;gap:12px;color:var(--muted);font-size:.82rem}.account form{margin:0}.account button{border:1px solid var(--line);border-radius:8px;padding:7px 10px;background:transparent;color:var(--text);font:inherit;cursor:pointer}main{padding-top:42px}h1{max-width:790px;margin:0;font-size:clamp(2rem,4vw,3.7rem);line-height:1.04;letter-spacing:-.055em}.lead{max-width:760px;margin:18px 0 36px;color:var(--muted);font-size:1.05rem}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}.card,.panel{border:1px solid var(--line);border-radius:18px;background:linear-gradient(180deg,rgba(23,31,47,.95),rgba(12,16,25,.96));box-shadow:0 18px 60px rgba(0,0,0,.2)}.card{min-height:145px;padding:20px}.eyebrow{color:var(--muted);font-size:.72rem;font-weight:750;letter-spacing:.09em;text-transform:uppercase}.metric{margin:14px 0 5px;font-size:1.45rem;font-weight:800;letter-spacing:-.04em}.detail{margin:0;color:var(--muted);font-size:.88rem}.status{display:inline-flex;align-items:center;gap:7px;color:var(--amber);font-size:.88rem;font-weight:700}.dot{width:7px;height:7px;border-radius:50%;background:currentColor}.columns,.setup-grid{display:grid;grid-template-columns:1.35fr .85fr;gap:16px;margin-top:16px}.setup-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.panel{padding:24px}h2{margin:0 0 4px;font-size:1.1rem;letter-spacing:-.025em}.subhead{margin:0 0 20px;color:var(--muted);font-size:.88rem}.empty{display:grid;place-items:center;min-height:220px;border:1px dashed rgba(255,255,255,.18);border-radius:13px;color:var(--muted);text-align:center;padding:28px}.empty strong{display:block;margin-bottom:5px;color:var(--text)}ul{list-style:none;padding:0;margin:0}li{display:grid;gap:3px;padding:14px 0;border-top:1px solid var(--line)}li:first-child{border-top:0}li b{font-size:.92rem}li span{color:var(--muted);font-size:.83rem}.setup-form{display:grid;gap:10px;padding:16px;border:1px solid var(--line);border-radius:13px;background:rgba(0,0,0,.12)}.setup-form label{display:grid;gap:5px;color:var(--muted);font-size:.78rem;font-weight:700}.setup-form input,.setup-form select{width:100%;border:1px solid var(--line);border-radius:8px;padding:9px 10px;background:#090d15;color:var(--text);font:inherit}.setup-form button{border:0;border-radius:8px;padding:10px;background:linear-gradient(135deg,var(--blue),#7c3cff);color:#fff;font:700 .9rem inherit;cursor:pointer}.compact-list{margin-top:12px}.compact-list li{grid-template-columns:1fr auto;align-items:center;padding:10px 0}.quiet{color:var(--muted);font-size:.86rem}.connect-link{color:var(--cyan);font-weight:700}.form-notice{margin:16px 0 0;padding:11px 13px;border:1px solid rgba(89,255,178,.26);border-radius:10px;background:rgba(89,255,178,.06);color:var(--green);font-size:.88rem}.guard{display:flex;gap:11px;margin-top:16px;padding:15px;border:1px solid rgba(89,255,178,.26);border-radius:13px;background:rgba(89,255,178,.06);color:var(--muted);font-size:.86rem}.guard b{color:var(--green)}@media(max-width:960px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.columns,.setup-grid{grid-template-columns:1fr}}@media(max-width:560px){.shell{width:min(100% - 28px,1440px);padding-top:20px}.account{align-items:flex-end;flex-direction:column}.grid{grid-template-columns:1fr}}</style></head>
<body><div class="shell"><header><div class="brand"><span class="mark">PZ</span><span>PostOpz Console</span><span class="badge">INTERNAL ALPHA</span></div><div class="account"><span>${escapeHtml(user.email || 'Console operator')}</span><form method="post" action="/console"><input type="hidden" name="action" value="sign_out"><button type="submit">Sign out</button></form></div></header><main><h1>Operational visibility, safely staged.</h1><p class="lead">Workspace: ${workspaceMessage}</p><section class="grid"><article class="card"><p class="eyebrow">Integrations</p><p class="metric">${healthy} of 8 healthy</p><p class="detail">Read-only source setup is pending.</p></article><article class="card"><p class="eyebrow">Productions</p><p class="metric">${dashboard.productions.length}</p><p class="detail">Visible through organization access rules.</p></article><article class="card"><p class="eyebrow">Archive candidates</p><p class="metric">${ready}</p><p class="detail">Ready for operator review.</p></article><article class="card"><p class="eyebrow">Migration execution</p><p class="metric"><span class="status"><span class="dot"></span>Disabled</span></p><p class="detail">No job can delete source media.</p></article></section>${setupPanel(dashboard, notice, requestToken)}<section class="columns"><article class="panel"><h2>Activity</h2><p class="subhead">Normalized events from authorized sources.</p>${dashboard.activity.length ? `<ul>${activity}</ul>` : activity}</article><article class="panel"><h2>Alpha safeguards</h2><p class="subhead">Every future action is constrained by the data model and role policy.</p><ul><li><b>Read-only integrations first</b><span>Credentials are referenced outside the database, never stored in event data.</span></li><li><b>Approval before execution</b><span>Only approvers can authorize a migration proposal.</span></li><li><b>Verification and hold</b><span>Jobs are limited to copy → verify → register → hold.</span></li></ul></article></section><aside class="guard"><div><b>Source-media safeguard:</b> this alpha has no source-deletion capability in its interface, data model, or job state machine.</div></aside></main></div></body></html>`;
}

function providerName(provider) {
  return String(provider || '').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function shortDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Awaiting data' : date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function consolePage(user, dashboard, notice = '', requestToken = '', selectedView = 'overview') {
  const views = ['overview', 'productions', 'integrations', 'storage', 'activity', 'settings'];
  const view = views.includes(selectedView) ? selectedView : 'overview';
  const healthy = dashboard.integrations.filter((item) => item.status === 'healthy').length;
  const activeProductions = dashboard.productions.filter((item) => item.status === 'active').length;
  const reviewReady = dashboard.recommendations.filter((item) => item.status === 'ready_for_review').length;
  const operatorWorkspaces = operatorOrganizations(dashboard);
  const workspaceOptions = operatorWorkspaces.map((organization) => `<option value="${escapeHtml(organization.id)}">${escapeHtml(organization.name)}</option>`).join('');
  const nav = [
    ['overview', 'Overview', '◌'], ['productions', 'Productions', '◇'], ['integrations', 'Integrations', '⌁'],
    ['storage', 'Storage', '▣'], ['activity', 'Activity', '↗'], ['settings', 'Settings', '⚙']
  ].map(([id, label, icon]) => `<a class="nav-item ${id === view ? 'active' : ''}" href="/console?view=${id}"><span>${icon}</span>${label}</a>`).join('');
  const activityRows = dashboard.activity.length
    ? `<div class="event-list">${dashboard.activity.map((item) => `<article class="event"><span class="event-dot ${escapeHtml(item.severity || 'info')}"></span><div><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.detail || 'No additional details')}</p></div><time>${escapeHtml(shortDate(item.occurred_at))}</time></article>`).join('')}</div>`
    : `<div class="empty-state"><span class="empty-icon">↗</span><strong>Your activity timeline is ready</strong><p>Connect a source or add a production to begin building an operational record.</p></div>`;
  const integrationRows = dashboard.integrations.length
    ? `<div class="source-list">${dashboard.integrations.map((item) => `<article class="source-row"><span class="source-mark">${escapeHtml(providerName(item.provider).slice(0, 1))}</span><div><strong>${escapeHtml(item.display_name || providerName(item.provider))}</strong><p>${escapeHtml(providerName(item.provider))} · ${item.last_synced_at ? `Last indexed ${escapeHtml(shortDate(item.last_synced_at))}` : 'Connection setup pending'}</p></div><span class="status-pill ${escapeHtml(item.status)}"><i></i>${escapeHtml(item.status)}</span></article>`).join('')}</div>`
    : `<div class="empty-state compact"><span class="empty-icon">⌁</span><strong>No sources connected</strong><p>Start with the tools your team is already using.</p></div>`;
  const google = dashboard.integrations.find((item) => item.provider === 'google_drive');
  const frame = dashboard.integrations.find((item) => item.provider === 'frame_io');
  const connectionActions = `${google ? `<a class="button primary" href="/console/google/connect">${google.status === 'healthy' ? 'Refresh Google Drive' : 'Connect Google Drive'}</a>` : ''}${frame ? `<a class="button secondary" href="/console/frameio/connect">Connect Frame.io</a>` : ''}`;
  const overview = `<section class="hero"><div><p class="eyebrow">${escapeHtml(dashboard.organizations.map((organization) => organization.name).join(' · ') || 'PostOpz workspace')}</p><h1>Know what needs<br>your attention.</h1><p class="hero-copy">A private operational view across your production systems. The alpha is read-only by design.</p></div><aside class="hero-status"><span class="live-dot"></span><div><b>Console is monitoring</b><p>${healthy} active source${healthy === 1 ? '' : 's'} · Source deletion disabled</p></div></aside></section><section class="metric-grid"><article class="metric-card"><p>Production health</p><strong>${activeProductions ? 'Tracked' : '—'}</strong><span>${activeProductions ? `${activeProductions} active production${activeProductions === 1 ? '' : 's'}` : 'Add a production to begin'}</span></article><article class="metric-card"><p>Connected sources</p><strong>${healthy}<em> / ${dashboard.integrations.length || 0}</em></strong><span>${healthy ? 'Reporting normally' : 'Setup in progress'}</span></article><article class="metric-card"><p>Archive review</p><strong>${reviewReady || '—'}</strong><span>${reviewReady ? 'Candidates awaiting approval' : 'No recommendations yet'}</span></article><article class="metric-card secure"><p>Migration control</p><strong>Safe</strong><span><i></i> Source deletion is disabled</span></article></section><section class="split-grid"><article class="panel timeline-panel"><div class="panel-heading"><div><p class="eyebrow">Operational timeline</p><h2>What changed</h2></div><a href="/console?view=activity">View all</a></div>${activityRows}</article><article class="panel action-panel"><p class="eyebrow">Next best step</p><h2>${google && google.status === 'healthy' ? 'Review your indexed media context' : 'Connect the tools you use today'}</h2><p>${google && google.status === 'healthy' ? 'Google Drive metadata is now available to the Console. Add a production next so activity can be organized by work.' : 'Connect Google Drive or Frame.io first. Console only requests the access needed for its current read-only feature.'}</p><div class="button-stack">${connectionActions || '<a class="button primary" href="/console?view=integrations">Set up integrations</a>'}</div><small>Credentials remain outside the Console database.</small></article></section>`;
  const productionView = `<section class="page-heading"><p class="eyebrow">Production control</p><h1>Productions</h1><p>Register work for visibility and context. This does not create a project in any connected service.</p></section><section class="split-grid"><article class="panel form-panel"><h2>Register a production</h2><form method="post" action="/console?view=productions"><input type="hidden" name="action" value="register_production"><input type="hidden" name="form_token" value="${escapeHtml(requestToken)}"><label>Workspace<select name="organization_id" required>${workspaceOptions}</select></label><label>Production name<input name="name" maxlength="240" placeholder="e.g. Strongman — Episode 104" required></label><label>Status<select name="status"><option value="active">Active</option><option value="planned">Planned</option><option value="delivered">Delivered</option><option value="on_hold">On hold</option><option value="archived">Archived</option></select></label><button class="button primary" type="submit">Add production</button></form></article><article class="panel"><div class="panel-heading"><div><p class="eyebrow">Workspace record</p><h2>Current productions</h2></div><span class="count-badge">${dashboard.productions.length}</span></div>${dashboard.productions.length ? `<div class="production-list">${dashboard.productions.map((item) => `<article><span class="production-icon">◇</span><div><strong>${escapeHtml(item.name)}</strong><p>PostOpz workspace</p></div><span class="status-pill neutral">${escapeHtml(item.status)}</span></article>`).join('')}</div>` : '<div class="empty-state compact"><span class="empty-icon">◇</span><strong>No productions yet</strong><p>Begin by registering the production you want Console to track.</p></div>'}</article></section>`;
  const integrationView = `<section class="page-heading"><p class="eyebrow">Source setup</p><h1>Integrations</h1><p>Each connection begins read-only. Console indexes operational metadata; it never stores provider passwords or tokens.</p></section><section class="split-grid"><article class="panel"><div class="panel-heading"><div><p class="eyebrow">Connected sources</p><h2>Integration health</h2></div><span class="count-badge">${dashboard.integrations.length}</span></div>${integrationRows}</article><article class="panel form-panel"><h2>Add a source</h2><p class="quiet">Register a connection before configuring its credentials in the appropriate secure provider setup.</p><form method="post" action="/console?view=integrations"><input type="hidden" name="action" value="register_integration"><input type="hidden" name="form_token" value="${escapeHtml(requestToken)}"><label>Workspace<select name="organization_id" required>${workspaceOptions}</select></label><label>Provider<select name="provider" required><option value="google_drive">Google Drive / Docs</option><option value="frame_io">Frame.io</option><option value="slack">Slack</option><option value="iconik">iconik</option><option value="masv">MASV</option><option value="aws_s3">AWS S3</option><option value="backblaze_b2">Backblaze B2</option><option value="wasabi">Wasabi</option><option value="lucidlink">LucidLink</option><option value="avid_media_composer">Avid Media Composer</option><option value="adobe_premiere_pro">Adobe Premiere Pro</option><option value="davinci_resolve">DaVinci Resolve</option></select></label><label>Connection name<input name="display_name" maxlength="120" placeholder="e.g. Victory Road Drive" required></label><button class="button primary" type="submit">Register connection</button></form></article></section><section class="provider-grid"><article><span>G</span><strong>Google Drive & Docs</strong><p>Metadata indexing, document reading, and time-limited download sessions.</p>${google ? `<a href="/console/google/connect">${google.status === 'healthy' ? 'Refresh connection' : 'Finish setup'}</a>` : '<span class="muted">Register above to configure</span>'}</article><article><span>F</span><strong>Frame.io</strong><p>Review activity, comments, approvals, and media events.</p>${frame ? '<a href="/console/frameio/connect">Finish setup</a>' : '<span class="muted">Register above to configure</span>'}</article><article><span>☁</span><strong>Storage providers</strong><p>AWS S3, Backblaze B2, and Wasabi inventory follow in the storage alpha.</p><span class="muted">Not connected</span></article></section>`;
  const storageView = `<section class="page-heading"><p class="eyebrow">Storage intelligence</p><h1>Storage</h1><p>Capacity, spend, archive recommendations, and operator-controlled migrations will appear here.</p></section><section class="storage-hero"><div><span class="storage-icon">▣</span><h2>No storage accounts connected</h2><p>When an AWS S3, Backblaze B2, or Wasabi account is connected, Console will calculate capacity risk, projected spend, and archive candidates from production context.</p><a class="button primary" href="/console?view=integrations">Register a storage source</a></div><aside><p>Safety model</p><ol><li>Copy</li><li>Verify</li><li>Register</li><li>Hold</li><li class="disabled">Delete — disabled in alpha</li></ol></aside></section>`;
  const activityView = `<section class="page-heading"><p class="eyebrow">Operational record</p><h1>Activity</h1><p>A normalized timeline of authorized source changes, created for production context rather than notification overload.</p></section><section class="panel full-panel">${activityRows}</section>`;
  const settingsView = `<section class="page-heading"><p class="eyebrow">Console administration</p><h1>Settings</h1><p>Access and governance are intentionally conservative during the alpha.</p></section><section class="settings-grid"><article class="panel"><p class="eyebrow">Your access</p><h2>${escapeHtml(user.email || 'Console operator')}</h2><p class="quiet">Workspace role: ${escapeHtml(operatorWorkspaces.length ? 'Operator' : 'Viewer')}</p><span class="status-pill healthy"><i></i> Authenticated</span></article><article class="panel"><p class="eyebrow">Data safeguards</p><h2>Controlled by default</h2><ul class="check-list"><li>Provider credentials stay in secure runtime configuration.</li><li>Read-only sources are staged before any workflow action.</li><li>Source-media deletion is not available in this alpha.</li></ul></article></section>`;
  const pages = { overview, productions: productionView, integrations: integrationView, storage: storageView, activity: activityView, settings: settingsView };
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>PostOpz Console — Internal Alpha</title><style>
  :root{color-scheme:dark;--bg:#080b12;--rail:#0d111a;--panel:#111827;--panel-2:#141c2a;--line:rgba(184,201,228,.13);--text:#f6f8fc;--muted:#99a5b8;--dim:#69778d;--cyan:#37d9ff;--blue:#4778ff;--violet:#8454ff;--green:#60d6a2;--amber:#ffbf5b;--danger:#ff8d9a}*{box-sizing:border-box}body{margin:0;min-width:320px;background:radial-gradient(circle at 80% -20%,rgba(71,120,255,.22),transparent 32rem),var(--bg);color:var(--text);font:14px/1.55 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}a{color:inherit;text-decoration:none}.app{min-height:100vh;display:grid;grid-template-columns:252px minmax(0,1fr)}.rail{position:sticky;top:0;height:100vh;display:flex;flex-direction:column;padding:24px 14px;border-right:1px solid var(--line);background:linear-gradient(180deg,#0d111a,rgba(13,17,26,.83))}.brand{display:flex;align-items:center;gap:10px;padding:0 10px;font-size:1rem;font-weight:800}.brand-mark,.source-mark,.production-icon{display:grid;place-items:center;flex:0 0 auto;background:linear-gradient(135deg,var(--blue),var(--violet));color:white}.brand-mark{width:31px;height:31px;border-radius:9px;font-size:.73rem;letter-spacing:.04em}.alpha-tag{margin-left:auto;padding:3px 7px;border:1px solid rgba(55,217,255,.35);border-radius:99px;color:var(--cyan);font-size:.6rem;font-weight:800;letter-spacing:.09em}.workspace{margin:34px 10px 13px;color:var(--dim);font-size:.65rem;font-weight:800;letter-spacing:.1em;text-transform:uppercase}.nav{display:grid;gap:4px}.nav-item{display:flex;align-items:center;gap:12px;padding:10px;border-radius:8px;color:var(--muted);font-weight:650}.nav-item span{width:18px;color:#aeb9cc;text-align:center;font-size:1.05rem}.nav-item:hover,.nav-item.active{color:var(--text);background:rgba(104,128,173,.12)}.nav-item.active{box-shadow:inset 2px 0 var(--cyan)}.rail-bottom{margin-top:auto;padding:15px 10px 4px;border-top:1px solid var(--line)}.account-email{overflow:hidden;color:var(--muted);font-size:.74rem;text-overflow:ellipsis;white-space:nowrap}.sign-out{margin-top:9px;border:0;padding:0;background:none;color:#d7dfec;font:inherit;font-size:.78rem;cursor:pointer}.content{min-width:0;padding:26px 40px 54px}.topbar{display:flex;align-items:center;justify-content:space-between;gap:18px;margin:0 auto 38px;max-width:1380px}.crumb{color:var(--muted);font-size:.78rem}.crumb b{color:var(--text)}.private-status{display:flex;align-items:center;gap:8px;color:var(--muted);font-size:.75rem}.live-dot{width:7px;height:7px;border-radius:50%;background:var(--green);box-shadow:0 0 0 4px rgba(96,214,162,.1)}main{max-width:1380px;margin:auto}.hero{display:flex;align-items:flex-end;justify-content:space-between;gap:28px;margin-bottom:34px}.eyebrow{margin:0 0 8px;color:var(--cyan);font-size:.67rem;font-weight:800;letter-spacing:.11em;text-transform:uppercase}.hero h1,.page-heading h1{margin:0;letter-spacing:-.058em;line-height:1.01}.hero h1{font-size:clamp(2.7rem,5vw,4.8rem)}.hero-copy,.page-heading>p:not(.eyebrow){max-width:590px;margin:15px 0 0;color:var(--muted);font-size:1rem}.hero-status{display:flex;align-items:center;gap:12px;min-width:255px;padding:14px 16px;border:1px solid var(--line);border-radius:12px;background:rgba(17,24,39,.72)}.hero-status b{font-size:.82rem}.hero-status p{margin:2px 0 0;color:var(--muted);font-size:.73rem}.metric-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.metric-card,.panel,.provider-grid article,.storage-hero{border:1px solid var(--line);border-radius:14px;background:linear-gradient(180deg,rgba(20,28,42,.88),rgba(12,17,26,.92));box-shadow:0 18px 50px rgba(0,0,0,.12)}.metric-card{min-height:148px;padding:19px}.metric-card p{margin:0;color:var(--muted);font-size:.76rem;font-weight:650}.metric-card strong{display:block;margin:13px 0 7px;font-size:1.55rem;letter-spacing:-.045em}.metric-card strong em{color:var(--dim);font-size:.85rem;font-style:normal;font-weight:600}.metric-card span{color:var(--muted);font-size:.76rem}.metric-card.secure strong{color:var(--green)}.metric-card.secure i{display:inline-block;width:6px;height:6px;margin-right:5px;border-radius:50%;background:var(--green)}.split-grid{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(315px,.8fr);gap:12px;margin-top:12px}.panel{padding:23px}.panel-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:17px}.panel-heading h2,.panel h2,.storage-hero h2{margin:0;font-size:1.13rem;letter-spacing:-.025em}.panel-heading>a,.provider-grid a{color:var(--cyan);font-size:.78rem;font-weight:750}.event-list{display:grid}.event{display:grid;grid-template-columns:10px minmax(0,1fr) auto;gap:12px;align-items:start;padding:15px 0;border-top:1px solid var(--line)}.event:first-child{padding-top:0;border-top:0}.event-dot{width:7px;height:7px;margin-top:7px;border-radius:50%;background:var(--cyan)}.event-dot.warning{background:var(--amber)}.event-dot.critical{background:var(--danger)}.event-dot.advisory{background:#a884ff}.event strong{display:block;font-size:.84rem}.event p{margin:2px 0 0;color:var(--muted);font-size:.77rem}.event time{padding-left:10px;color:var(--dim);font-size:.69rem;white-space:nowrap}.action-panel{display:flex;flex-direction:column}.action-panel>p:not(.eyebrow){margin:11px 0;color:var(--muted);font-size:.84rem}.button-stack{display:flex;flex-wrap:wrap;gap:8px;margin-top:auto;padding-top:14px}.button{display:inline-flex;justify-content:center;align-items:center;min-height:37px;padding:0 13px;border:0;border-radius:8px;font:700 .78rem inherit;cursor:pointer}.button.primary{background:linear-gradient(135deg,var(--blue),var(--violet));color:white}.button.secondary{border:1px solid var(--line);background:rgba(255,255,255,.04);color:var(--text)}.action-panel small{margin-top:13px;color:var(--dim);font-size:.68rem}.empty-state{display:grid;justify-items:center;align-content:center;min-height:210px;padding:24px;text-align:center;border:1px dashed rgba(184,201,228,.2);border-radius:11px}.empty-state.compact{min-height:156px}.empty-icon{display:grid;place-items:center;width:32px;height:32px;margin-bottom:11px;border-radius:9px;background:rgba(71,120,255,.16);color:var(--cyan);font-size:1.05rem}.empty-state strong{font-size:.85rem}.empty-state p{max-width:300px;margin:4px 0 0;color:var(--muted);font-size:.76rem}.page-heading{margin-bottom:28px}.page-heading h1{font-size:clamp(2.3rem,4vw,3.8rem)}.form-panel form{display:grid;gap:12px;margin-top:18px}.form-panel label{display:grid;gap:5px;color:var(--muted);font-size:.7rem;font-weight:750}.form-panel input,.form-panel select{width:100%;border:1px solid var(--line);border-radius:8px;padding:10px;background:#090e17;color:var(--text);font:inherit;font-size:.83rem}.form-panel .button{margin-top:4px}.quiet{margin:6px 0 0;color:var(--muted);font-size:.78rem}.count-badge{display:grid;place-items:center;min-width:27px;height:27px;border-radius:8px;background:rgba(71,120,255,.16);color:var(--cyan);font-size:.76rem;font-weight:800}.production-list,.source-list{display:grid}.production-list article,.source-row{display:grid;grid-template-columns:32px minmax(0,1fr) auto;gap:11px;align-items:center;padding:13px 0;border-top:1px solid var(--line)}.production-list article:first-child,.source-row:first-child{padding-top:0;border-top:0}.production-icon,.source-mark{width:28px;height:28px;border-radius:8px;font-size:.72rem;font-weight:850}.production-list strong,.source-row strong{font-size:.82rem}.production-list p,.source-row p{margin:1px 0 0;color:var(--muted);font-size:.72rem}.status-pill{display:inline-flex;align-items:center;gap:6px;padding:4px 8px;border-radius:99px;background:rgba(255,255,255,.06);color:var(--muted);font-size:.67rem;font-weight:750;text-transform:capitalize}.status-pill i{width:5px;height:5px;border-radius:50%;background:currentColor}.status-pill.healthy{color:var(--green);background:rgba(96,214,162,.09)}.status-pill.pending{color:var(--amber);background:rgba(255,191,91,.08)}.status-pill.degraded{color:var(--danger)}.status-pill.neutral{color:#b6c2d5}.provider-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:12px}.provider-grid article{padding:19px}.provider-grid article>span:first-child{display:grid;place-items:center;width:30px;height:30px;border-radius:8px;background:rgba(71,120,255,.16);color:var(--cyan);font-weight:850}.provider-grid strong{display:block;margin:15px 0 3px;font-size:.85rem}.provider-grid p{min-height:42px;margin:0 0 14px;color:var(--muted);font-size:.75rem}.provider-grid .muted{color:var(--dim);font-size:.73rem}.storage-hero{display:grid;grid-template-columns:minmax(0,1fr) 290px;gap:30px;padding:34px}.storage-icon{display:grid;place-items:center;width:42px;height:42px;margin-bottom:17px;border-radius:11px;background:rgba(71,120,255,.16);color:var(--cyan);font-size:1.25rem}.storage-hero p{max-width:620px;margin:10px 0 20px;color:var(--muted)}.storage-hero aside{padding:18px;border:1px solid var(--line);border-radius:11px;background:rgba(0,0,0,.12)}.storage-hero aside p{margin:0 0 11px;color:var(--text);font-size:.76rem;font-weight:800}.storage-hero ol{display:grid;gap:7px;margin:0;padding-left:20px;color:var(--muted);font-size:.78rem}.storage-hero li::marker{color:var(--cyan);font-weight:800}.storage-hero li.disabled{color:var(--danger)}.full-panel{padding:0}.full-panel .event-list{padding:22px}.settings-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.check-list{display:grid;gap:9px;margin:16px 0 0;padding:0;list-style:none}.check-list li{padding-left:18px;color:var(--muted);font-size:.78rem}.check-list li:before{content:'✓';margin-left:-18px;margin-right:8px;color:var(--green);font-weight:800}.notice{margin-bottom:14px;padding:11px 13px;border:1px solid rgba(96,214,162,.28);border-radius:9px;background:rgba(96,214,162,.08);color:var(--green);font-size:.8rem}@media(max-width:1080px){.metric-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.app{grid-template-columns:210px minmax(0,1fr)}.content{padding:24px}.storage-hero{grid-template-columns:1fr}}@media(max-width:760px){.app{display:block}.rail{position:relative;height:auto;padding:17px;border-right:0;border-bottom:1px solid var(--line)}.workspace,.rail-bottom{display:none}.nav{grid-template-columns:repeat(3,1fr);margin-top:17px}.nav-item{justify-content:center;padding:8px 4px;font-size:.69rem}.nav-item span{display:none}.content{padding:20px 14px 36px}.topbar{margin-bottom:28px}.hero{display:grid;gap:18px}.hero-status{min-width:0}.split-grid,.settings-grid{grid-template-columns:1fr}.provider-grid{grid-template-columns:1fr}.event{grid-template-columns:10px minmax(0,1fr)}.event time{grid-column:2;padding:0}.metric-grid{grid-template-columns:1fr 1fr}.storage-hero{padding:22px}.page-heading{margin-bottom:22px}}@media(max-width:420px){.metric-grid{grid-template-columns:1fr}.nav{grid-template-columns:repeat(2,1fr)}}
  </style></head><body><div class="app"><aside class="rail"><a class="brand" href="/console"><span class="brand-mark">PZ</span><span>PostOpz Console</span><span class="alpha-tag">ALPHA</span></a><p class="workspace">Command center</p><nav class="nav">${nav}</nav><div class="rail-bottom"><div class="account-email">${escapeHtml(user.email || 'Console operator')}</div><form method="post" action="/console"><input type="hidden" name="action" value="sign_out"><button class="sign-out" type="submit">Sign out</button></form></div></aside><div class="content"><header class="topbar"><p class="crumb"><b>PostOpz</b> / Console</p><p class="private-status"><span class="live-dot"></span>Private alpha · no public access</p></header><main>${notice ? `<p class="notice">${escapeHtml(notice)}</p>` : ''}${pages[view]}</main></div></div></body></html>`;
}

function responsePage(body, headers = {}) {
  // The official circular mark is deliberately cropped to its PZ letterforms
  // here. It preserves the original lettering and cyan-to-blue treatment in
  // the compact rounded-square Console app frame.
  const officialLogo = '<img src="/assets/postopz-pz-icon.png" alt="" style="position:absolute;top:50%;left:50%;width:170%;height:auto;max-width:none;transform:translate(-50%,-50%)">';
  const logoMarkStyle = 'style="position:relative;overflow:hidden;background:#071220;border:1px solid rgba(58,214,255,.35);box-shadow:inset 0 1px 0 rgba(255,255,255,.08),0 4px 12px rgba(0,0,0,.22)"';
  const brandedBody = String(body)
    .replaceAll('<span class="brand-mark">PZ</span>', `<span class="brand-mark" ${logoMarkStyle}>${officialLogo}</span>`)
    .replaceAll('<span class="mark">PZ</span>', `<span class="mark" ${logoMarkStyle}>${officialLogo}</span>`);
  return { statusCode: 200, headers: { ...securityHeaders, 'Content-Type': 'text/html; charset=utf-8', ...headers }, body: brandedBody };
}

exports.handler = async (event) => {
  const expectedPassword = process.env.POSTOPZ_CONSOLE_ALPHA_PASSWORD;
  if (!expectedPassword) return textResponse(503, 'PostOpz Console has not been configured.');

  const authorization = getAuthorization(event.headers || {});
  if (!authorization.startsWith('Basic ')) return unauthorized();

  let decoded;
  try { decoded = Buffer.from(authorization.slice(6), 'base64').toString('utf8'); } catch (_) { return unauthorized(); }
  const separator = decoded.indexOf(':');
  if (separator < 0) return unauthorized();
  if (!credentialsMatch(decoded.slice(0, separator), 'operator') || !credentialsMatch(decoded.slice(separator + 1), expectedPassword)) return unauthorized();

  const config = supabaseConfig();
  if (!config) return responsePage(loginPage('Console is waiting for its Supabase connection values.'));

  let form = null;
  if (event.httpMethod === 'POST') {
    form = parseForm(event);
    if (form.action === 'sign_out') {
      return { statusCode: 303, headers: { ...securityHeaders, Location: '/console', 'Set-Cookie': `${SESSION_COOKIE}=; Path=/console; HttpOnly; Secure; SameSite=Lax; Max-Age=0` }, body: '' };
    }
    if (form.action === 'sign_in') {
      const session = await signIn(config, String(form.email || '').trim(), String(form.password || ''));
      if (!session) return responsePage(loginPage('We could not sign in with those details.'));
      return { statusCode: 303, headers: { ...securityHeaders, Location: '/console', 'Set-Cookie': `${SESSION_COOKIE}=${encodeURIComponent(session.access_token)}; Path=/console; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.max(60, Number(session.expires_in || 3600))}` }, body: '' };
    }
  }

  const accessToken = readCookies(event.headers || {})[SESSION_COOKIE];
  const user = await currentUser(config, accessToken);
  if (!user) return responsePage(loginPage());
  const selectedView = String((event.queryStringParameters || {}).view || 'overview');
  const requestToken = formToken(accessToken, expectedPassword);

  let dashboard = await dashboardData(config, accessToken);
  if (form) {
    if (!credentialsMatch(String(form.form_token || ''), requestToken)) return textResponse(403, 'Invalid Console form request. Refresh the page and try again.');
    let result;
    if (form.action === 'register_production') result = await registerProduction(config, accessToken, dashboard, form);
    else if (form.action === 'register_integration') result = await registerIntegration(config, accessToken, dashboard, form);
    else return textResponse(400, 'Unsupported Console action.');

    if (result.ok) {
      dashboard = await dashboardData(config, accessToken);
      const message = form.action === 'register_production'
        ? 'Production added. It is available only inside your PostOpz workspace.'
        : 'Pending connection registered. No provider credential has been saved or used.';
      return responsePage(consolePage(user, dashboard, message, requestToken, selectedView));
    }
    return responsePage(consolePage(user, dashboard, result.message, requestToken, selectedView));
  }

  return responsePage(consolePage(user, dashboard, '', requestToken, selectedView));
};
