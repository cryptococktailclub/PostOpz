const crypto = require('crypto');
const slackShared = require('./slack-shared');

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
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  return url && key ? { url: url.replace(/\/$/, ''), key, secretKey } : null;
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

async function supabaseServiceRequest(config, path, options = {}) {
  if (!config.secretKey) return { ok: false, status: 503, data: null };
  const response = await fetch(`${config.url}${path}`, { method: options.method || 'GET', headers: { apikey: config.secretKey, Authorization: `Bearer ${config.secretKey}`, ...(options.headers || {}) }, body: options.body });
  const body = await response.text(); let data = null;
  try { data = body ? JSON.parse(body) : null; } catch (_) { data = null; }
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
      supabaseRequest(config, '/rest/v1/productions?select=id,organization_id,name,status&order=updated_at.desc&limit=30', { accessToken }),
      supabaseRequest(config, '/rest/v1/integration_connections?select=id,organization_id,provider,display_name,status,last_synced_at,configuration&order=provider', { accessToken }),
      supabaseRequest(config, '/rest/v1/activity_items?select=id,title,detail,severity,occurred_at&order=occurred_at.desc&limit=8', { accessToken }),
      supabaseRequest(config, '/rest/v1/archive_recommendations?select=id,status,estimated_bytes,confidence&order=created_at.desc&limit=8', { accessToken }),
      supabaseRequest(config, '/rest/v1/organization_members?select=organization_id,role', { accessToken }),
      supabaseRequest(config, '/rest/v1/workspace_files?select=id,organization_id,production_id,file_name,content_type,size_bytes,document_type,version_label,created_at&order=created_at.desc&limit=30', { accessToken })
    ]);

    return {
      organizations: requests[0].ok ? requests[0].data : [],
      productions: requests[1].ok ? requests[1].data : [],
      integrations: requests[2].ok ? requests[2].data : [],
      activity: requests[3].ok ? requests[3].data : [],
      recommendations: requests[4].ok ? requests[4].data : [],
      memberships: requests[5].ok ? requests[5].data : [],
      workspaceFiles: requests[6].ok ? requests[6].data : []
    };
  } catch (_) {
    return { organizations: [], productions: [], integrations: [], activity: [], recommendations: [], memberships: [], workspaceFiles: [] };
  }
}

function operatorOrganizations(dashboard) {
  const roles = new Map((dashboard.memberships || []).map((member) => [member.organization_id, member.role]));
  return (dashboard.organizations || []).filter((organization) => ['operator', 'admin'].includes(roles.get(organization.id)));
}

async function postSlackMessage(config, dashboard, user, form) {
  const connection = dashboard.integrations.find((item) => item.provider === 'slack');
  const token = process.env.POSTOPZ_SLACK_BOT_TOKEN;
  const channelId = String(form.channel_id || '');
  const text = String(form.message || '').trim();
  const threadTs = String(form.thread_ts || '');
  if (!connection || !token) return { ok: false, message: 'Slack is not fully configured yet.' };
  if (!operatorOrganizations(dashboard).some((organization) => organization.id === connection.organization_id)) return { ok: false, message: 'Only Console Operators and Admins can post to Slack.' };
  const allowed = Array.isArray(connection.configuration && connection.configuration.selected_channel_ids) ? connection.configuration.selected_channel_ids : [];
  if (!allowed.includes(channelId)) return { ok: false, message: 'Choose one of the Slack channels approved for this Console connection.' };
  if (text.length < 1 || text.length > 4000) return { ok: false, message: 'Slack messages must be between 1 and 4,000 characters in this alpha.' };
  if (threadTs && !/^[0-9]+\.[0-9]+$/.test(threadTs)) return { ok: false, message: 'That Slack thread could not be verified.' };
  try {
    const response = await fetch('https://slack.com/api/chat.postMessage', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify({ channel: channelId, text, ...(threadTs ? { thread_ts: threadTs } : {}) }) });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result || !result.ok || !result.ts) return { ok: false, message: result && result.error === 'missing_scope' ? 'Slack needs the chat:write bot scope. Add it, reinstall the app, then reconnect Console.' : 'Slack could not post this message. Confirm the app belongs to the selected channel.' };
    const digest = crypto.createHash('sha256').update(text, 'utf8').digest('hex');
    const providerEventId = `slack:outgoing:${channelId}:${result.ts}`;
    const source = await supabaseServiceRequest(config, '/rest/v1/source_events?on_conflict=organization_id,provider,provider_event_id', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify({ organization_id: connection.organization_id, integration_connection_id: connection.id, provider: 'slack', provider_event_id: providerEventId, occurred_at: new Date(Number(result.ts) * 1000).toISOString(), payload: { direction: 'outgoing', channel_id: channelId, thread_ts: threadTs || null, sender_id: user.id, author_name: user.email || 'Console Operator', text_excerpt: text, text_truncated: false, text_sha256: digest }, payload_sha256: digest }) });
    const inserted = source.ok && Array.isArray(source.data) ? source.data[0] : null;
    if (inserted) await supabaseServiceRequest(config, '/rest/v1/activity_items?on_conflict=source_event_id', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ organization_id: connection.organization_id, source_event_id: inserted.id, kind: 'message_sent', title: 'Console posted to Slack', detail: text, severity: 'info', occurred_at: inserted.occurred_at }) });
    await supabaseServiceRequest(config, '/rest/v1/audit_log', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ organization_id: connection.organization_id, actor_id: user.id, action: 'slack.message.posted', entity_type: 'integration_connection', entity_id: connection.id, metadata: { channel_id: channelId, thread_ts: threadTs || null, text_sha256: digest, character_count: text.length } }) });
    return { ok: true, message: 'Message posted to Slack and recorded in the Console audit log.' };
  } catch (_) { return { ok: false, message: 'Console could not reach Slack.' }; }
}

async function refreshSlackActivity(dashboard, user) {
  const configured = slackShared.config();
  const connection = dashboard.integrations.find((item) => item.provider === 'slack');
  if (!configured || !configured.botToken || !connection) return { ok: false, message: 'Slack is not fully configured yet.' };
  if (!operatorOrganizations(dashboard).some((organization) => organization.id === connection.organization_id)) return { ok: false, message: 'Only Console Operators and Admins can refresh Slack activity.' };
  const ids = Array.isArray(connection.configuration && connection.configuration.selected_channel_ids) ? connection.configuration.selected_channel_ids : [];
  const names = Array.isArray(connection.configuration && connection.configuration.selected_channel_names) ? connection.configuration.selected_channel_names : [];
  const channels = ids.slice(0, 5).map((id, index) => ({ id, name: names[index] || id })).filter((channel) => /^[CG][A-Z0-9]{6,20}$/.test(channel.id));
  if (!channels.length) return { ok: false, message: 'Choose at least one Slack channel before refreshing its activity.' };
  try {
    const result = await slackShared.indexSlackActivity(configured, connection, configured.botToken, channels, user.id);
    return { ok: true, message: `Slack activity refreshed: ${result.observedMessageCount} recent messages checked across ${result.selectedChannelCount} channel${result.selectedChannelCount === 1 ? '' : 's'}.` };
  } catch (_) {
    return { ok: false, message: 'Slack could not refresh activity. Confirm the app is in each selected channel and its token still has channels:history.' };
  }
}

async function saveSlackAlertPreferences(config, accessToken, dashboard, form) {
  const connection = dashboard.integrations.find((item) => item.provider === 'slack');
  const channelId = String(form.workspace_file_uploaded_channel_id || '');
  const enabled = form.workspace_file_uploaded === 'on';
  if (!connection || !process.env.POSTOPZ_SLACK_BOT_TOKEN) return { ok: false, message: 'Finish the Slack connection and save its bot token before enabling alerts.' };
  if (!operatorOrganizations(dashboard).some((organization) => organization.id === connection.organization_id)) return { ok: false, message: 'Only Console Operators and Admins can change Slack alert preferences.' };
  const allowed = Array.isArray(connection.configuration && connection.configuration.selected_channel_ids) ? connection.configuration.selected_channel_ids : [];
  if (enabled && !allowed.includes(channelId)) return { ok: false, message: 'Choose an approved Slack channel for workspace-file alerts.' };
  const configuration = { ...(connection.configuration || {}), alerts: { ...(connection.configuration && connection.configuration.alerts || {}), workspace_file_uploaded: enabled, workspace_file_uploaded_channel_id: enabled ? channelId : null } };
  const result = await supabaseRequest(config, `/rest/v1/integration_connections?id=eq.${encodeURIComponent(connection.id)}`, { method: 'PATCH', accessToken, headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ configuration }) });
  return result.ok ? { ok: true, message: enabled ? 'Workspace-file alerts are enabled for the chosen Slack channel.' : 'Workspace-file alerts are disabled.' } : { ok: false, message: 'Console could not save Slack alert preferences.' };
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

function openGoogleToken(value, password) {
  try {
    const payload = Buffer.from(String(value || ''), 'base64url');
    if (payload.length < 29) return null;
    const key = crypto.createHash('sha256').update(password, 'utf8').digest();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, payload.subarray(0, 12));
    decipher.setAuthTag(payload.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString('utf8'));
  } catch (_) {
    return null;
  }
}

function validGoogleId(value) {
  return value === 'root' || /^[A-Za-z0-9_-]{3,200}$/.test(String(value || ''));
}

async function googleDriveBrowser(headers, password, query = {}) {
  const token = openGoogleToken(readCookies(headers).postopz_google_drive_oauth_token, password);
  if (!token || !token.accessToken) return { state: 'disconnected' };
  if (Number(token.expiresAt || 0) < Date.now()) return { state: 'expired' };
  const folderId = validGoogleId(query.folder_id) ? String(query.folder_id || 'root') : 'root';
  const documentId = validGoogleId(query.doc_id) && query.doc_id !== 'root' ? String(query.doc_id) : '';
  const filter = ['all', 'docs', 'files'].includes(String(query.filter || '')) ? String(query.filter) : 'all';
  const sort = ['name_asc', 'name_desc', 'size_desc', 'size_asc'].includes(String(query.sort || '')) ? String(query.sort) : 'name_asc';
  const search = String(query.q || '').trim().slice(0, 120);
  const googleRequest = async (url) => {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token.accessToken}` } });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }
    return { ok: response.ok, data };
  };
  try {
    if (documentId) {
      const file = await googleRequest(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(documentId)}?fields=id,name,mimeType,parents,webViewLink,modifiedTime`);
      if (!file.ok || !file.data || file.data.mimeType !== 'application/vnd.google-apps.document') return { state: 'error', message: 'That Google Doc is no longer available to this account.' };
      const document = await googleRequest(`https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}`);
      if (!document.ok || !document.data) return { state: 'error', message: 'Google Docs could not return that document.' };
      const text = (document.data.body && document.data.body.content || []).flatMap((element) => (element.paragraph && element.paragraph.elements || []).map((part) => part.textRun && part.textRun.content || '')).join('').slice(0, 100000);
      return { state: 'connected', folderId, filter, sort, search, document: { ...file.data, text }, files: [] };
    }
    const queryValue = `'${folderId.replace(/'/g, "\\'")}' in parents and trashed = false`;
    const params = new URLSearchParams({ q: queryValue, pageSize: '100', orderBy: 'folder,name', fields: 'files(id,name,mimeType,modifiedTime,size,webViewLink,parents)' });
    const result = await googleRequest(`https://www.googleapis.com/drive/v3/files?${params}`);
    if (!result.ok) return { state: 'error', message: 'Google Drive could not load this folder.' };
    return { state: 'connected', folderId, filter, sort, search, files: Array.isArray(result.data && result.data.files) ? result.data.files : [] };
  } catch (_) {
    return { state: 'error', message: 'Console could not reach Google Drive just now.' };
  }
}

function fileSize(value) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return 'Size not reported';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function workspaceFilesPanel(dashboard, requestToken) {
  const workspaces = operatorOrganizations(dashboard);
  if (!workspaces.length) return '<section class="workspace-files-panel panel"><p class="eyebrow">Console documents</p><h2>Workspace Files needs an operator workspace</h2><p class="quiet">Ask an administrator to assign your Console account an operator role before uploading documents.</p></section>';
  const organizationOptions = workspaces.map((organization) => `<option value="${escapeHtml(organization.id)}">${escapeHtml(organization.name)}</option>`).join('');
  const productionOptions = (dashboard.productions || []).map((production) => `<option value="${escapeHtml(production.id)}">${escapeHtml(production.name)}</option>`).join('');
  const files = dashboard.workspaceFiles || [];
  const rows = files.length ? files.map((file) => `<article class="workspace-file"><span class="workspace-file-icon">${escapeHtml(file.document_type.slice(0, 1).toUpperCase())}</span><div><strong>${escapeHtml(file.file_name)}</strong><p>${escapeHtml(file.document_type.replaceAll('_', ' '))}${file.version_label ? ` · ${escapeHtml(file.version_label)}` : ''} · ${escapeHtml(fileSize(file.size_bytes))}</p></div><div class="workspace-file-actions"><time>${escapeHtml(shortDate(file.created_at))}</time><a href="/console/workspace-files/download?id=${encodeURIComponent(file.id)}">Download</a></div></article>`).join('') : '<div class="empty-state compact"><span class="empty-icon">↑</span><strong>No Console documents yet</strong><p>Upload a brief, turnover, EDL, or delivery document to start the workspace library.</p></div>';
  return `<section class="workspace-files-grid"><article class="panel workspace-upload"><p class="eyebrow">Console documents</p><h2>Upload production paperwork</h2><p class="quiet">PDF, text, CSV, EDL, XML, JSON, Word, and Excel files up to 5 MB. Source media is not accepted here.</p><form method="post" action="/console/workspace-files/upload" enctype="multipart/form-data"><input type="hidden" name="form_token" value="${escapeHtml(requestToken)}"><label>Workspace<select name="organization_id" required>${organizationOptions}</select></label><label>Production <span>(optional)</span><select name="production_id"><option value="">Not assigned to a production</option>${productionOptions}</select></label><div class="upload-two"><label>Document type<select name="document_type"><option value="brief">Brief</option><option value="script">Script</option><option value="turnover">Turnover</option><option value="edl">EDL</option><option value="xml">XML</option><option value="delivery_spec">Delivery spec</option><option value="call_sheet">Call sheet</option><option value="schedule">Schedule</option><option value="other">Other</option></select></label><label>Version <span>(optional)</span><input name="version_label" maxlength="80" placeholder="v1, final, 2026-07-27"></label></div><label>File<input name="file" type="file" accept=".pdf,.txt,.csv,.edl,.xml,.json,.doc,.docx,.xls,.xlsx" required></label><button class="button primary" type="submit">Upload to Workspace Files</button></form></article><article class="panel workspace-library"><div class="panel-heading"><div><p class="eyebrow">Private library</p><h2>Uploaded documents</h2></div><span class="count-badge">${files.length}</span></div><div class="workspace-file-list">${rows}</div></article></section>`;
}

function googleMediaPage(google, dashboard, requestToken) {
  const workspaceFiles = workspaceFilesPanel(dashboard, requestToken);
  const pageIntro = `<section class="page-heading"><p class="eyebrow">Production documents</p><h1>Workspace Files</h1><p>Upload and organize Console-owned paperwork here, then browse authorized Google Drive folders without confusing either with production footage.</p></section>${workspaceFiles}`;
  const connect = '<a class="button primary" href="/console/google/connect">Connect Google Drive</a>';
  if (google.state === 'disconnected' || google.state === 'expired') return `${pageIntro}<section class="drive-connect"><span class="drive-logo">G</span><div><h2>${google.state === 'expired' ? 'Your Google session has expired' : 'Connect Google Drive'}</h2><p>Browse the folders and Google Docs available to your authorized Google account. Console will not create, edit, move, or delete Drive content.</p>${connect}</div></section>`;
  if (google.state === 'error') return `${pageIntro}<section class="drive-connect error"><span class="drive-logo">!</span><div><h2>Drive needs attention</h2><p>${escapeHtml(google.message || 'Google Drive could not load.')}</p>${connect}</div></section>`;
  if (google.document) {
    const parentId = google.document.parents && google.document.parents[0] || google.folderId || 'root';
    return `${pageIntro}<section class="page-heading google-heading"><p class="eyebrow">Google Drive · Read only</p><h2>${escapeHtml(google.document.name || 'Google Doc')}</h2><p>Viewing live document content in Console. This reading session expires automatically and document text is not retained here.</p></section><div class="drive-toolbar"><a href="/console?view=media&folder_id=${encodeURIComponent(parentId)}">← Back to folder</a>${google.document.webViewLink ? `<a href="${escapeHtml(google.document.webViewLink)}" target="_blank" rel="noopener noreferrer">Open in Google Docs ↗</a>` : ''}</div><article class="document-panel"><pre>${escapeHtml(google.document.text || 'This document has no readable text.')}</pre></article>`;
  }
  const matches = (google.files || []).filter((file) => {
    const isFolder = file.mimeType === 'application/vnd.google-apps.folder';
    const isDocument = file.mimeType === 'application/vnd.google-apps.document';
    const nameMatches = !google.search || String(file.name || '').toLocaleLowerCase().includes(google.search.toLocaleLowerCase());
    return nameMatches && (google.filter === 'all' || (google.filter === 'docs' && isDocument) || (google.filter === 'files' && !isFolder && !isDocument));
  }).sort((left, right) => {
    if (google.sort === 'size_desc' || google.sort === 'size_asc') {
      const direction = google.sort === 'size_desc' ? -1 : 1;
      return direction * (Number(left.size || -1) - Number(right.size || -1)) || String(left.name || '').localeCompare(String(right.name || ''));
    }
    const direction = google.sort === 'name_desc' ? -1 : 1;
    return direction * String(left.name || '').localeCompare(String(right.name || ''));
  });
  const folders = matches.filter((file) => file.mimeType === 'application/vnd.google-apps.folder');
  const files = matches.filter((file) => file.mimeType !== 'application/vnd.google-apps.folder');
  const filterOption = (value, label) => `<option value="${value}"${google.filter === value ? ' selected' : ''}>${label}</option>`;
  const sortOption = (value, label) => `<option value="${value}"${google.sort === value ? ' selected' : ''}>${label}</option>`;
  const controls = `<form class="drive-controls" method="get" action="/console"><input type="hidden" name="view" value="media"><input type="hidden" name="folder_id" value="${escapeHtml(google.folderId)}"><label>Find by filename<input name="q" value="${escapeHtml(google.search)}" placeholder="Search this folder"></label><label>Show<select name="filter">${filterOption('all', 'Everything')}${filterOption('docs', 'Google Docs')}${filterOption('files', 'Drive files')}</select></label><label>Sort<select name="sort">${sortOption('name_asc', 'Filename A–Z')}${sortOption('name_desc', 'Filename Z–A')}${sortOption('size_desc', 'Largest first')}${sortOption('size_asc', 'Smallest first')}</select></label><button class="button secondary" type="submit">Apply</button></form>${matches.length ? '' : '<div class="empty-state compact drive-empty"><span class="empty-icon">⌕</span><strong>No matching items</strong><p>Try a different filename, content type, or sort.</p></div>'}`;
  const folderCards = `${controls}${folders.length ? folders.map((file) => `<a class="drive-item folder" href="/console?view=media&folder_id=${encodeURIComponent(file.id)}"><span class="file-icon">□</span><strong>${escapeHtml(file.name || 'Untitled folder')}</strong><small>Folder</small></a>`).join('') : ''}`;
  const fileCards = files.length ? files.map((file) => {
    const isDocument = file.mimeType === 'application/vnd.google-apps.document';
    const href = isDocument ? `/console?view=media&folder_id=${encodeURIComponent(google.folderId)}&doc_id=${encodeURIComponent(file.id)}` : (file.webViewLink || '#');
    const target = isDocument ? '' : ' target="_blank" rel="noopener noreferrer"';
    const details = isDocument ? `Google Doc · ${escapeHtml(shortDate(file.modifiedTime))}` : `${escapeHtml(fileSize(file.size))} · ${escapeHtml(shortDate(file.modifiedTime))}`;
    return `<a class="drive-item" href="${escapeHtml(href)}"${target}><span class="file-icon ${isDocument ? 'doc' : ''}">${isDocument ? '≡' : '·'}</span><strong>${escapeHtml(file.name || 'Untitled file')}</strong><small>${details}</small></a>`;
  }).join('') : '';
  return `${pageIntro}<section class="page-heading google-heading"><p class="eyebrow">Google Drive · Read only</p><h2>Browse Google Drive</h2><p>Browsing ${google.folderId === 'root' ? 'your Drive root folder' : 'a Drive folder'} in Console. Select a folder to navigate, or a Google Doc to read it here.</p></section><div class="drive-toolbar"><a href="/console?view=media&folder_id=root">⌂ Drive root</a><a href="/console/google/connect">Refresh session</a></div><section class="drive-browser">${folderCards || fileCards ? `${folderCards}${fileCards}` : '<div class="empty-state compact"><span class="empty-icon">□</span><strong>This folder is empty</strong><p>No accessible folders or files were returned by Google Drive.</p></div>'}</section>`;
}

async function slackBrowser(dashboard, query = {}) {
  const connection = dashboard.integrations.find((item) => item.provider === 'slack');
  const token = process.env.POSTOPZ_SLACK_BOT_TOKEN;
  const configuration = connection && connection.configuration || {};
  const channelIds = Array.isArray(configuration.selected_channel_ids) ? configuration.selected_channel_ids : [];
  const channelNames = Array.isArray(configuration.selected_channel_names) ? configuration.selected_channel_names : [];
  const channels = channelIds.map((id, index) => ({ id, name: channelNames[index] || id })).filter((channel) => /^[CG][A-Z0-9]{6,20}$/.test(channel.id));
  const canPost = Boolean(connection && operatorOrganizations(dashboard).some((organization) => organization.id === connection.organization_id));
  if (!connection) return { state: 'unregistered', channels: [] };
  if (!token) return { state: 'waiting', channels };
  if (!channels.length) return { state: 'choose_channels', channels: [] };
  const selectedId = String(query.channel_id || channels[0].id);
  const selected = channels.find((channel) => channel.id === selectedId) || channels[0];
  const search = String(query.q || '').trim().slice(0, 100);
  const threadTs = String(query.thread_ts || '');
  const slackRequest = async (method, params) => {
    const response = await fetch(`https://slack.com/api/${method}?${new URLSearchParams(params)}`, { headers: { Authorization: `Bearer ${token}` } });
    const data = await response.json().catch(() => null);
    return { ok: response.ok && !!(data && data.ok), data };
  };
  try {
    const result = threadTs && /^[0-9]+\.[0-9]+$/.test(threadTs)
      ? await slackRequest('conversations.replies', { channel: selected.id, ts: threadTs, limit: '100' })
      : await slackRequest('conversations.history', { channel: selected.id, limit: '100' });
    if (!result.ok) return { state: 'error', channels, selected, search, threadTs, message: 'Slack could not return this channel. Confirm the app has been added to the channel and still has its read-only scopes.' };
    const rawMessages = (Array.isArray(result.data.messages) ? result.data.messages : [])
      .filter((message) => message && message.type === 'message' && !message.hidden)
      .filter((message) => !search || String(message.text || '').toLocaleLowerCase().includes(search.toLocaleLowerCase()))
      .slice(0, 100);
    const userIds = [...new Set(rawMessages.map((message) => message.user || message.bot_id).filter((id) => /^[UW][A-Z0-9]{6,20}$/.test(id)))].slice(0, 30);
    const identities = await Promise.all(userIds.map(async (id) => {
      const profile = await slackRequest('users.info', { user: id });
      const user = profile.ok && profile.data && profile.data.user;
      return [id, user && (user.profile && (user.profile.display_name || user.profile.real_name) || user.real_name || user.name) || null];
    }));
    const names = new Map(identities.filter(([, name]) => name));
    const friendlyText = (value) => String(value || '').replace(/<@([UW][A-Z0-9]{6,20})>/g, (_, id) => names.has(id) ? `@${names.get(id)}` : '@Slack member').slice(0, 6000);
    const messages = rawMessages.map((message) => { const userId = message.user || message.bot_id || ''; return { ts: String(message.ts || ''), threadTs: message.thread_ts || null, replyCount: Number(message.reply_count || 0), user: names.get(userId) || 'Slack member', subtype: message.subtype || null, text: friendlyText(message.text) }; });
    return { state: 'ready', channels, selected, messages, search, threadTs, teamId: configuration.team_id || '', canPost, alerts: configuration.alerts || {} };
  } catch (_) {
    return { state: 'error', channels, selected, search, threadTs, message: 'Console could not reach Slack right now.' };
  }
}

function slackPage(slack, requestToken) {
  const intro = '<section class="page-heading"><p class="eyebrow">Slack · Channel workspace</p><h1>Team activity</h1><p>Browse selected public Slack channels inside Console. Selected-channel message excerpts are retained in the private operational timeline.</p></section>';
  if (slack.state === 'unregistered') return `${intro}<section class="drive-connect"><span class="drive-logo">S</span><div><h2>Register Slack first</h2><p>Add a Slack connection in Integrations, then configure its read-only app credentials.</p><a class="button primary" href="/console?view=integrations">Open Integrations</a></div></section>`;
  if (slack.state === 'waiting') return `${intro}<section class="drive-connect"><span class="drive-logo">S</span><div><h2>Slack needs its secure runtime token</h2><p>Finish the Console Slack connection once to add the read-only bot token to Netlify. Console cannot read any messages until that token exists.</p><a class="button primary" href="/console/slack/connect">Finish Slack setup</a></div></section>`;
  if (slack.state === 'choose_channels') return `${intro}<section class="drive-connect"><span class="drive-logo">S</span><div><h2>Choose channels to monitor</h2><p>Connect Slack and select up to five public channels. You control exactly what Console can read.</p><a class="button primary" href="/console/slack/connect">Choose Slack channels</a></div></section>`;
  const options = slack.channels.map((channel) => `<option value="${escapeHtml(channel.id)}"${channel.id === slack.selected.id ? ' selected' : ''}>#${escapeHtml(channel.name)}</option>`).join('');
  const control = `<form class="slack-controls" method="get" action="/console"><input type="hidden" name="view" value="slack"><label>Channel<select name="channel_id">${options}</select></label><label>Find in loaded messages<input name="q" value="${escapeHtml(slack.search || '')}" placeholder="Search message text"></label><button class="button secondary" type="submit">View</button></form>`;
  if (slack.state === 'error') return `${intro}${control}<section class="drive-connect error"><span class="drive-logo">!</span><div><h2>Slack needs attention</h2><p>${escapeHtml(slack.message)}</p><a class="button primary" href="/console/slack/connect">Refresh Slack connection</a></div></section>`;
  const back = slack.threadTs ? `<a href="/console?view=slack&channel_id=${encodeURIComponent(slack.selected.id)}${slack.search ? `&q=${encodeURIComponent(slack.search)}` : ''}">← Back to #${escapeHtml(slack.selected.name)}</a>` : '';
  const rows = slack.messages.length ? slack.messages.map((message) => {
    const permalink = slack.teamId ? `https://app.slack.com/client/${encodeURIComponent(slack.teamId)}/${encodeURIComponent(slack.selected.id)}/p${encodeURIComponent(message.ts.replace('.', ''))}` : '#';
    const threadLink = !slack.threadTs && (message.replyCount || message.threadTs) ? `<a href="/console?view=slack&channel_id=${encodeURIComponent(slack.selected.id)}&thread_ts=${encodeURIComponent(message.threadTs || message.ts)}">${message.replyCount ? `${message.replyCount} repl${message.replyCount === 1 ? 'y' : 'ies'}` : 'View thread'}</a>` : '';
    return `<article class="slack-message"><div class="slack-avatar">${escapeHtml(String(message.user).slice(0, 1).toUpperCase())}</div><div><strong>${escapeHtml(message.user)}</strong><time>${escapeHtml(shortDate(new Date(Number(message.ts) * 1000).toISOString()))}</time><p>${escapeHtml(message.text || (message.subtype ? `Slack ${message.subtype} event` : 'No readable message text.')).replaceAll('\n', '<br>')}</p><span class="slack-actions">${threadLink}<a href="${permalink}" target="_blank" rel="noopener noreferrer">Open in Slack ↗</a></span></div></article>`;
  }).join('') : '<div class="empty-state compact"><span class="empty-icon">S</span><strong>No matching messages</strong><p>Try another selected channel or clear the search.</p></div>';
  const channelOptions = slack.channels.map((channel) => `<option value="${escapeHtml(channel.id)}"${channel.id === slack.selected.id ? ' selected' : ''}>#${escapeHtml(channel.name)}</option>`).join('');
  const composerTarget = slack.threadTs ? `<input type="hidden" name="channel_id" value="${escapeHtml(slack.selected.id)}"><p class="compose-target">Replying in #${escapeHtml(slack.selected.name)}</p>` : `<label>Channel<select name="channel_id">${channelOptions}</select></label>`;
  const composer = slack.canPost ? `<section class="slack-compose"><div><p class="eyebrow">Console to Slack</p><h2>${slack.threadTs ? 'Reply in this thread' : 'Write a Slack message'}</h2><p>Posts as the PostOpz Console Slack app, only to an approved channel. Every post is audit logged.</p></div><form method="post" action="/console?view=slack&channel_id=${encodeURIComponent(slack.selected.id)}${slack.threadTs ? `&thread_ts=${encodeURIComponent(slack.threadTs)}` : ''}"><input type="hidden" name="action" value="post_slack_message"><input type="hidden" name="form_token" value="${escapeHtml(requestToken)}"><input type="hidden" name="thread_ts" value="${escapeHtml(slack.threadTs || '')}">${composerTarget}<label>Message<textarea name="message" maxlength="4000" required placeholder="Write a clear operational update or alert…"></textarea></label><button class="button primary" type="submit">${slack.threadTs ? 'Send reply' : 'Post to Slack'}</button></form></section>` : '<p class="quiet slack-role-note">Your Console role can read Slack activity. An Operator or Admin can post messages and configure automated alerts.</p>';
  const alertChannel = String(slack.alerts && slack.alerts.workspace_file_uploaded_channel_id || '');
  const alerts = slack.canPost ? `<section class="slack-alerts"><div><p class="eyebrow">Automated alerts</p><h2>Workspace Files</h2><p>Optionally post a Slack alert when an approved user uploads production paperwork to Workspace Files.</p></div><form method="post" action="/console?view=slack&channel_id=${encodeURIComponent(slack.selected.id)}"><input type="hidden" name="action" value="save_slack_alert_preferences"><input type="hidden" name="form_token" value="${escapeHtml(requestToken)}"><label class="check-label"><input type="checkbox" name="workspace_file_uploaded"${slack.alerts && slack.alerts.workspace_file_uploaded ? ' checked' : ''}> Alert when a Workspace File is uploaded</label><label>Alert channel<select name="workspace_file_uploaded_channel_id">${slack.channels.map((channel) => `<option value="${escapeHtml(channel.id)}"${channel.id === alertChannel ? ' selected' : ''}>#${escapeHtml(channel.name)}</option>`).join('')}</select></label><button class="button secondary" type="submit">Save alert preference</button></form></section>` : '';
  const refresh = slack.canPost ? `<form class="inline-action" method="post" action="/console?view=slack&channel_id=${encodeURIComponent(slack.selected.id)}"><input type="hidden" name="action" value="refresh_slack_activity"><input type="hidden" name="form_token" value="${escapeHtml(requestToken)}"><button class="button secondary" type="submit">Refresh Slack activity</button></form>` : '';
  return `${intro}${control}<div class="drive-toolbar slack-toolbar">${back}${refresh}<a href="/console/slack/connect">Manage channels</a></div>${composer}<section class="slack-panel"><div class="panel-heading"><div><p class="eyebrow">${slack.threadTs ? 'Conversation thread' : 'Live channel view'}</p><h2>#${escapeHtml(slack.selected.name)}</h2></div><span class="status-pill healthy"><i></i>${slack.canPost ? 'Read & write' : 'Read only'}</span></div>${rows}</section>${alerts}`;
}

function consolePage(user, dashboard, notice = '', requestToken = '', selectedView = 'overview', googleSession = { state: 'disconnected' }, slackSession = { state: 'unregistered' }) {
  const views = ['overview', 'productions', 'media', 'slack', 'integrations', 'storage', 'activity', 'settings'];
  const view = views.includes(selectedView) ? selectedView : 'overview';
  const healthy = dashboard.integrations.filter((item) => item.status === 'healthy').length;
  const activeProductions = dashboard.productions.filter((item) => item.status === 'active').length;
  const reviewReady = dashboard.recommendations.filter((item) => item.status === 'ready_for_review').length;
  const operatorWorkspaces = operatorOrganizations(dashboard);
  const workspaceOptions = operatorWorkspaces.map((organization) => `<option value="${escapeHtml(organization.id)}">${escapeHtml(organization.name)}</option>`).join('');
  const nav = [
    ['overview', 'Overview', '◌'], ['productions', 'Productions', '◇'], ['media', 'Workspace Files', '▤'], ['slack', 'Slack', 'S'], ['integrations', 'Integrations', '⌁'],
    ['storage', 'Storage', '▣'], ['activity', 'Activity', '↗'], ['settings', 'Settings', '⚙']
  ].map(([id, label, icon]) => `<a class="nav-item ${id === view ? 'active' : ''}" href="/console?view=${id}"><span>${icon}</span>${label}</a>`).join('');
  const activityRows = dashboard.activity.length
    ? `<div class="event-list" data-live-activity>${dashboard.activity.map((item) => `<article class="event"><span class="event-dot ${escapeHtml(item.severity || 'info')}"></span><div><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.detail || 'No additional details')}</p></div><time>${escapeHtml(shortDate(item.occurred_at))}</time></article>`).join('')}</div>`
    : `<div class="event-list" data-live-activity><div class="empty-state"><span class="empty-icon">↗</span><strong>Your activity timeline is ready</strong><p>Connect a source or add a production to begin building an operational record.</p></div></div>`;
  const integrationRows = dashboard.integrations.length
    ? `<div class="source-list">${dashboard.integrations.map((item) => `<article class="source-row"><span class="source-mark">${escapeHtml(providerName(item.provider).slice(0, 1))}</span><div><strong>${escapeHtml(item.display_name || providerName(item.provider))}</strong><p>${escapeHtml(providerName(item.provider))} · ${item.last_synced_at ? `Last indexed ${escapeHtml(shortDate(item.last_synced_at))}` : 'Connection setup pending'}</p></div><span class="status-pill ${escapeHtml(item.status)}"><i></i>${escapeHtml(item.status)}</span></article>`).join('')}</div>`
    : `<div class="empty-state compact"><span class="empty-icon">⌁</span><strong>No sources connected</strong><p>Start with the tools your team is already using.</p></div>`;
  const google = dashboard.integrations.find((item) => item.provider === 'google_drive');
  const frame = dashboard.integrations.find((item) => item.provider === 'frame_io');
  const slack = dashboard.integrations.find((item) => item.provider === 'slack');
  const slackRefreshAction = slack && operatorWorkspaces.some((organization) => organization.id === slack.organization_id)
    ? `<form class="inline-action" method="post" action="/console"><input type="hidden" name="action" value="refresh_slack_activity"><input type="hidden" name="form_token" value="${escapeHtml(requestToken)}"><button class="button secondary" type="submit">Refresh Slack activity</button></form>`
    : '';
  const connectionActions = `${google ? `<a class="button primary" href="/console/google/connect">${google.status === 'healthy' ? 'Refresh Google Drive' : 'Connect Google Drive'}</a>` : ''}${slackRefreshAction}${slack ? `<a class="button secondary" href="/console/slack/connect">${slack.status === 'healthy' ? 'Manage Slack' : 'Connect Slack'}</a>` : ''}${frame ? `<a class="button secondary" href="/console/frameio/connect">Connect Frame.io</a>` : ''}`;
  const overview = `<section class="hero"><div><p class="eyebrow">${escapeHtml(dashboard.organizations.map((organization) => organization.name).join(' · ') || 'PostOpz workspace')}</p><h1>Know what needs<br>your attention.</h1><p class="hero-copy">A private operational view across your production systems. The alpha is read-only by design.</p></div><aside class="hero-status"><span class="live-dot"></span><div><b>Console is monitoring</b><p>${healthy} active source${healthy === 1 ? '' : 's'} · Source deletion disabled</p></div></aside></section><section class="metric-grid"><article class="metric-card"><p>Production health</p><strong>${activeProductions ? 'Tracked' : '—'}</strong><span>${activeProductions ? `${activeProductions} active production${activeProductions === 1 ? '' : 's'}` : 'Add a production to begin'}</span></article><article class="metric-card"><p>Connected sources</p><strong>${healthy}<em> / ${dashboard.integrations.length || 0}</em></strong><span>${healthy ? 'Reporting normally' : 'Setup in progress'}</span></article><article class="metric-card"><p>Archive review</p><strong>${reviewReady || '—'}</strong><span>${reviewReady ? 'Candidates awaiting approval' : 'No recommendations yet'}</span></article><article class="metric-card secure"><p>Migration control</p><strong>Safe</strong><span><i></i> Source deletion is disabled</span></article></section><section class="split-grid"><article class="panel timeline-panel"><div class="panel-heading"><div><p class="eyebrow">Operational timeline</p><h2>What changed</h2></div><a href="/console?view=activity">View all</a></div>${activityRows}</article><article class="panel action-panel"><p class="eyebrow">Next best step</p><h2>${google && google.status === 'healthy' ? 'Review your indexed media context' : 'Connect the tools you use today'}</h2><p>${google && google.status === 'healthy' ? 'Google Drive metadata is now available to the Console. Add a production next so activity can be organized by work.' : 'Connect Google Drive or Frame.io first. Console only requests the access needed for its current read-only feature.'}</p><div class="button-stack">${connectionActions || '<a class="button primary" href="/console?view=integrations">Set up integrations</a>'}</div><small>Credentials remain outside the Console database.</small></article></section>`;
  const productionView = `<section class="page-heading"><p class="eyebrow">Production control</p><h1>Productions</h1><p>Register work for visibility and context. This does not create a project in any connected service.</p></section><section class="split-grid"><article class="panel form-panel"><h2>Register a production</h2><form method="post" action="/console?view=productions"><input type="hidden" name="action" value="register_production"><input type="hidden" name="form_token" value="${escapeHtml(requestToken)}"><label>Workspace<select name="organization_id" required>${workspaceOptions}</select></label><label>Production name<input name="name" maxlength="240" placeholder="e.g. Strongman — Episode 104" required></label><label>Status<select name="status"><option value="active">Active</option><option value="planned">Planned</option><option value="delivered">Delivered</option><option value="on_hold">On hold</option><option value="archived">Archived</option></select></label><button class="button primary" type="submit">Add production</button></form></article><article class="panel"><div class="panel-heading"><div><p class="eyebrow">Workspace record</p><h2>Current productions</h2></div><span class="count-badge">${dashboard.productions.length}</span></div>${dashboard.productions.length ? `<div class="production-list">${dashboard.productions.map((item) => `<article><span class="production-icon">◇</span><div><strong>${escapeHtml(item.name)}</strong><p>PostOpz workspace</p></div><span class="status-pill neutral">${escapeHtml(item.status)}</span></article>`).join('')}</div>` : '<div class="empty-state compact"><span class="empty-icon">◇</span><strong>No productions yet</strong><p>Begin by registering the production you want Console to track.</p></div>'}</article></section>`;
  const integrationView = `<section class="page-heading"><p class="eyebrow">Source setup</p><h1>Integrations</h1><p>Each connection begins read-only. Console indexes operational metadata; it never stores provider passwords or tokens.</p></section><section class="split-grid"><article class="panel"><div class="panel-heading"><div><p class="eyebrow">Connected sources</p><h2>Integration health</h2></div><span class="count-badge">${dashboard.integrations.length}</span></div>${integrationRows}</article><article class="panel form-panel"><h2>Add a source</h2><p class="quiet">Register a connection before configuring its credentials in the appropriate secure provider setup.</p><form method="post" action="/console?view=integrations"><input type="hidden" name="action" value="register_integration"><input type="hidden" name="form_token" value="${escapeHtml(requestToken)}"><label>Workspace<select name="organization_id" required>${workspaceOptions}</select></label><label>Provider<select name="provider" required><option value="google_drive">Google Drive / Docs</option><option value="frame_io">Frame.io</option><option value="slack">Slack</option><option value="iconik">iconik</option><option value="masv">MASV</option><option value="aws_s3">AWS S3</option><option value="backblaze_b2">Backblaze B2</option><option value="wasabi">Wasabi</option><option value="lucidlink">LucidLink</option><option value="avid_media_composer">Avid Media Composer</option><option value="adobe_premiere_pro">Adobe Premiere Pro</option><option value="davinci_resolve">DaVinci Resolve</option></select></label><label>Connection name<input name="display_name" maxlength="120" placeholder="e.g. Victory Road Drive" required></label><button class="button primary" type="submit">Register connection</button></form></article></section><section class="provider-grid"><article><span>G</span><strong>Google Drive & Docs</strong><p>Metadata indexing, document reading, and time-limited download sessions.</p>${google ? `<a href="/console/google/connect">${google.status === 'healthy' ? 'Refresh connection' : 'Finish setup'}</a>` : '<span class="muted">Register above to configure</span>'}</article><article><span>S</span><strong>Slack</strong><p>Public-channel activity, signed events, and a 15-minute fallback index.</p>${slack ? `<a href="/console/slack/connect">${slack.status === 'healthy' ? 'Refresh connection' : 'Finish setup'}</a>` : '<span class="muted">Register above to configure</span>'}</article><article><span>F</span><strong>Frame.io</strong><p>Review activity, comments, approvals, and media events.</p>${frame ? '<a href="/console/frameio/connect">Finish setup</a>' : '<span class="muted">Register above to configure</span>'}</article><article><span>☁</span><strong>Storage providers</strong><p>AWS S3, Backblaze B2, and Wasabi inventory follow in the storage alpha.</p><span class="muted">Not connected</span></article></section>`;
  const storageView = `<section class="page-heading"><p class="eyebrow">Storage intelligence</p><h1>Storage</h1><p>Capacity, spend, archive recommendations, and operator-controlled migrations will appear here.</p></section><section class="storage-hero"><div><span class="storage-icon">▣</span><h2>No storage accounts connected</h2><p>When an AWS S3, Backblaze B2, or Wasabi account is connected, Console will calculate capacity risk, projected spend, and archive candidates from production context.</p><a class="button primary" href="/console?view=integrations">Register a storage source</a></div><aside><p>Safety model</p><ol><li>Copy</li><li>Verify</li><li>Register</li><li>Hold</li><li class="disabled">Delete — disabled in alpha</li></ol></aside></section>`;
  const activityView = `<section class="page-heading"><p class="eyebrow">Operational record</p><h1>Activity</h1><p>A normalized timeline of authorized source changes, created for production context rather than notification overload.</p></section><section class="panel full-panel">${activityRows}</section>`;
  const settingsView = `<section class="page-heading"><p class="eyebrow">Console administration</p><h1>Settings</h1><p>Access and governance are intentionally conservative during the alpha.</p></section><section class="settings-grid"><article class="panel"><p class="eyebrow">Your access</p><h2>${escapeHtml(user.email || 'Console operator')}</h2><p class="quiet">Workspace role: ${escapeHtml(operatorWorkspaces.length ? 'Operator' : 'Viewer')}</p><span class="status-pill healthy"><i></i> Authenticated</span></article><article class="panel"><p class="eyebrow">Data safeguards</p><h2>Controlled by default</h2><ul class="check-list"><li>Provider credentials stay in secure runtime configuration.</li><li>Read-only sources are staged before any workflow action.</li><li>Source-media deletion is not available in this alpha.</li></ul></article></section>`;
  const pages = { overview, productions: productionView, media: googleMediaPage(googleSession, dashboard, requestToken), slack: slackPage(slackSession, requestToken), integrations: integrationView, storage: storageView, activity: activityView, settings: settingsView };
  const liveRefresh = ['overview', 'activity'].includes(view) ? '<meta http-equiv="refresh" content="10">' : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>PostOpz Console — Internal Alpha</title>${liveRefresh}<style>
  :root{color-scheme:dark;--bg:#080b12;--rail:#0d111a;--panel:#111827;--panel-2:#141c2a;--line:rgba(184,201,228,.13);--text:#f6f8fc;--muted:#99a5b8;--dim:#69778d;--cyan:#37d9ff;--blue:#4778ff;--violet:#8454ff;--green:#60d6a2;--amber:#ffbf5b;--danger:#ff8d9a}*{box-sizing:border-box}body{margin:0;min-width:320px;background:radial-gradient(circle at 80% -20%,rgba(71,120,255,.22),transparent 32rem),var(--bg);color:var(--text);font:14px/1.55 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}a{color:inherit;text-decoration:none}.app{min-height:100vh;display:grid;grid-template-columns:252px minmax(0,1fr)}.rail{position:sticky;top:0;height:100vh;display:flex;flex-direction:column;padding:24px 14px;border-right:1px solid var(--line);background:linear-gradient(180deg,#0d111a,rgba(13,17,26,.83))}.brand{display:flex;align-items:center;gap:10px;padding:0 10px;font-size:1rem;font-weight:800}.brand-mark,.source-mark,.production-icon{display:grid;place-items:center;flex:0 0 auto;background:linear-gradient(135deg,var(--blue),var(--violet));color:white}.brand-mark{width:31px;height:31px;border-radius:9px;font-size:.73rem;letter-spacing:.04em}.alpha-tag{margin-left:auto;padding:3px 7px;border:1px solid rgba(55,217,255,.35);border-radius:99px;color:var(--cyan);font-size:.6rem;font-weight:800;letter-spacing:.09em}.workspace{margin:34px 10px 13px;color:var(--dim);font-size:.65rem;font-weight:800;letter-spacing:.1em;text-transform:uppercase}.nav{display:grid;gap:4px}.nav-item{display:flex;align-items:center;gap:12px;padding:10px;border-radius:8px;color:var(--muted);font-weight:650}.nav-item span{width:18px;color:#aeb9cc;text-align:center;font-size:1.05rem}.nav-item:hover,.nav-item.active{color:var(--text);background:rgba(104,128,173,.12)}.nav-item.active{box-shadow:inset 2px 0 var(--cyan)}.rail-bottom{margin-top:auto;padding:15px 10px 4px;border-top:1px solid var(--line)}.account-email{overflow:hidden;color:var(--muted);font-size:.74rem;text-overflow:ellipsis;white-space:nowrap}.sign-out{margin-top:9px;border:0;padding:0;background:none;color:#d7dfec;font:inherit;font-size:.78rem;cursor:pointer}.content{min-width:0;padding:26px 40px 54px}.topbar{display:flex;align-items:center;justify-content:space-between;gap:18px;margin:0 auto 38px;max-width:1380px}.crumb{color:var(--muted);font-size:.78rem}.crumb b{color:var(--text)}.private-status{display:flex;align-items:center;gap:8px;color:var(--muted);font-size:.75rem}.live-dot{width:7px;height:7px;border-radius:50%;background:var(--green);box-shadow:0 0 0 4px rgba(96,214,162,.1)}main{max-width:1380px;margin:auto}.hero{display:flex;align-items:flex-end;justify-content:space-between;gap:28px;margin-bottom:34px}.eyebrow{margin:0 0 8px;color:var(--cyan);font-size:.67rem;font-weight:800;letter-spacing:.11em;text-transform:uppercase}.hero h1,.page-heading h1{margin:0;letter-spacing:-.058em;line-height:1.01}.hero h1{font-size:clamp(2.7rem,5vw,4.8rem)}.hero-copy,.page-heading>p:not(.eyebrow){max-width:590px;margin:15px 0 0;color:var(--muted);font-size:1rem}.hero-status{display:flex;align-items:center;gap:12px;min-width:255px;padding:14px 16px;border:1px solid var(--line);border-radius:12px;background:rgba(17,24,39,.72)}.hero-status b{font-size:.82rem}.hero-status p{margin:2px 0 0;color:var(--muted);font-size:.73rem}.metric-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.metric-card,.panel,.provider-grid article,.storage-hero{border:1px solid var(--line);border-radius:14px;background:linear-gradient(180deg,rgba(20,28,42,.88),rgba(12,17,26,.92));box-shadow:0 18px 50px rgba(0,0,0,.12)}.metric-card{min-height:148px;padding:19px}.metric-card p{margin:0;color:var(--muted);font-size:.76rem;font-weight:650}.metric-card strong{display:block;margin:13px 0 7px;font-size:1.55rem;letter-spacing:-.045em}.metric-card strong em{color:var(--dim);font-size:.85rem;font-style:normal;font-weight:600}.metric-card span{color:var(--muted);font-size:.76rem}.metric-card.secure strong{color:var(--green)}.metric-card.secure i{display:inline-block;width:6px;height:6px;margin-right:5px;border-radius:50%;background:var(--green)}.split-grid{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(315px,.8fr);gap:12px;margin-top:12px}.panel{padding:23px}.panel-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:17px}.panel-heading h2,.panel h2,.storage-hero h2{margin:0;font-size:1.13rem;letter-spacing:-.025em}.panel-heading>a,.provider-grid a{color:var(--cyan);font-size:.78rem;font-weight:750}.event-list{display:grid}.event{display:grid;grid-template-columns:10px minmax(0,1fr) auto;gap:12px;align-items:start;padding:15px 0;border-top:1px solid var(--line)}.event:first-child{padding-top:0;border-top:0}.event-dot{width:7px;height:7px;margin-top:7px;border-radius:50%;background:var(--cyan)}.event-dot.warning{background:var(--amber)}.event-dot.critical{background:var(--danger)}.event-dot.advisory{background:#a884ff}.event strong{display:block;font-size:.84rem}.event p{margin:2px 0 0;color:var(--muted);font-size:.77rem}.event time{padding-left:10px;color:var(--dim);font-size:.69rem;white-space:nowrap}.action-panel{display:flex;flex-direction:column}.action-panel>p:not(.eyebrow){margin:11px 0;color:var(--muted);font-size:.84rem}.button-stack{display:flex;flex-wrap:wrap;gap:8px;margin-top:auto;padding-top:14px}.button{display:inline-flex;justify-content:center;align-items:center;min-height:37px;padding:0 13px;border:0;border-radius:8px;font:700 .78rem inherit;cursor:pointer}.button.primary{background:linear-gradient(135deg,var(--blue),var(--violet));color:white}.button.secondary{border:1px solid var(--line);background:rgba(255,255,255,.04);color:var(--text)}.action-panel small{margin-top:13px;color:var(--dim);font-size:.68rem}.empty-state{display:grid;justify-items:center;align-content:center;min-height:210px;padding:24px;text-align:center;border:1px dashed rgba(184,201,228,.2);border-radius:11px}.empty-state.compact{min-height:156px}.empty-icon{display:grid;place-items:center;width:32px;height:32px;margin-bottom:11px;border-radius:9px;background:rgba(71,120,255,.16);color:var(--cyan);font-size:1.05rem}.empty-state strong{font-size:.85rem}.empty-state p{max-width:300px;margin:4px 0 0;color:var(--muted);font-size:.76rem}.page-heading{margin-bottom:28px}.page-heading h1{font-size:clamp(2.3rem,4vw,3.8rem)}.form-panel form{display:grid;gap:12px;margin-top:18px}.form-panel label{display:grid;gap:5px;color:var(--muted);font-size:.7rem;font-weight:750}.form-panel input,.form-panel select{width:100%;border:1px solid var(--line);border-radius:8px;padding:10px;background:#090e17;color:var(--text);font:inherit;font-size:.83rem}.form-panel .button{margin-top:4px}.quiet{margin:6px 0 0;color:var(--muted);font-size:.78rem}.count-badge{display:grid;place-items:center;min-width:27px;height:27px;border-radius:8px;background:rgba(71,120,255,.16);color:var(--cyan);font-size:.76rem;font-weight:800}.production-list,.source-list{display:grid}.production-list article,.source-row{display:grid;grid-template-columns:32px minmax(0,1fr) auto;gap:11px;align-items:center;padding:13px 0;border-top:1px solid var(--line)}.production-list article:first-child,.source-row:first-child{padding-top:0;border-top:0}.production-icon,.source-mark{width:28px;height:28px;border-radius:8px;font-size:.72rem;font-weight:850}.production-list strong,.source-row strong{font-size:.82rem}.production-list p,.source-row p{margin:1px 0 0;color:var(--muted);font-size:.72rem}.status-pill{display:inline-flex;align-items:center;gap:6px;padding:4px 8px;border-radius:99px;background:rgba(255,255,255,.06);color:var(--muted);font-size:.67rem;font-weight:750;text-transform:capitalize}.status-pill i{width:5px;height:5px;border-radius:50%;background:currentColor}.status-pill.healthy{color:var(--green);background:rgba(96,214,162,.09)}.status-pill.pending{color:var(--amber);background:rgba(255,191,91,.08)}.status-pill.degraded{color:var(--danger)}.status-pill.neutral{color:#b6c2d5}.provider-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:12px}.provider-grid article{padding:19px}.provider-grid article>span:first-child{display:grid;place-items:center;width:30px;height:30px;border-radius:8px;background:rgba(71,120,255,.16);color:var(--cyan);font-weight:850}.provider-grid strong{display:block;margin:15px 0 3px;font-size:.85rem}.provider-grid p{min-height:42px;margin:0 0 14px;color:var(--muted);font-size:.75rem}.provider-grid .muted{color:var(--dim);font-size:.73rem}.storage-hero{display:grid;grid-template-columns:minmax(0,1fr) 290px;gap:30px;padding:34px}.storage-icon{display:grid;place-items:center;width:42px;height:42px;margin-bottom:17px;border-radius:11px;background:rgba(71,120,255,.16);color:var(--cyan);font-size:1.25rem}.storage-hero p{max-width:620px;margin:10px 0 20px;color:var(--muted)}.storage-hero aside{padding:18px;border:1px solid var(--line);border-radius:11px;background:rgba(0,0,0,.12)}.storage-hero aside p{margin:0 0 11px;color:var(--text);font-size:.76rem;font-weight:800}.storage-hero ol{display:grid;gap:7px;margin:0;padding-left:20px;color:var(--muted);font-size:.78rem}.storage-hero li::marker{color:var(--cyan);font-weight:800}.storage-hero li.disabled{color:var(--danger)}.full-panel{padding:0}.full-panel .event-list{padding:22px}.settings-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.check-list{display:grid;gap:9px;margin:16px 0 0;padding:0;list-style:none}.check-list li{padding-left:18px;color:var(--muted);font-size:.78rem}.check-list li:before{content:'✓';margin-left:-18px;margin-right:8px;color:var(--green);font-weight:800}.notice{margin-bottom:14px;padding:11px 13px;border:1px solid rgba(96,214,162,.28);border-radius:9px;background:rgba(96,214,162,.08);color:var(--green);font-size:.8rem}@media(max-width:1080px){.metric-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.app{grid-template-columns:210px minmax(0,1fr)}.content{padding:24px}.storage-hero{grid-template-columns:1fr}}@media(max-width:760px){.app{display:block}.rail{position:relative;height:auto;padding:17px;border-right:0;border-bottom:1px solid var(--line)}.workspace,.rail-bottom{display:none}.nav{grid-template-columns:repeat(3,1fr);margin-top:17px}.nav-item{justify-content:center;padding:8px 4px;font-size:.69rem}.nav-item span{display:none}.content{padding:20px 14px 36px}.topbar{margin-bottom:28px}.hero{display:grid;gap:18px}.hero-status{min-width:0}.split-grid,.settings-grid{grid-template-columns:1fr}.provider-grid{grid-template-columns:1fr}.event{grid-template-columns:10px minmax(0,1fr)}.event time{grid-column:2;padding:0}.metric-grid{grid-template-columns:1fr 1fr}.storage-hero{padding:22px}.page-heading{margin-bottom:22px}}@media(max-width:420px){.metric-grid{grid-template-columns:1fr}.nav{grid-template-columns:repeat(2,1fr)}}
  </style></head><body><div class="app"><aside class="rail"><a class="brand" href="/console"><span class="brand-mark">PZ</span><span>PostOpz Console</span><span class="alpha-tag">ALPHA</span></a><p class="workspace">Command center</p><nav class="nav">${nav}</nav><div class="rail-bottom"><div class="account-email">${escapeHtml(user.email || 'Console operator')}</div><form method="post" action="/console"><input type="hidden" name="action" value="sign_out"><button class="sign-out" type="submit">Sign out</button></form></div></aside><div class="content"><header class="topbar"><p class="crumb"><b>PostOpz</b> / Console</p><p class="private-status"><span class="live-dot"></span>Private alpha · no public access</p></header><main>${notice ? `<p class="notice">${escapeHtml(notice)}</p>` : ''}${pages[view]}</main></div></div></body></html>`;
}

function responsePage(body, headers = {}) {
  // The Console uses the supplied PostOpz rounded-square icon directly. Its
  // centered artwork is cropped into the compact app-mark area without being
  // redrawn or restyled.
  const officialLogo = '<img src="/assets/postopz-console-icon.png" alt="" style="position:absolute;top:50%;left:50%;width:320%;height:auto;max-width:none;transform:translate(-50%,-50%)">';
  const logoMarkStyle = 'style="position:relative;overflow:hidden;background:#071220;border:0;box-shadow:0 4px 12px rgba(0,0,0,.22)"';
  const driveStyles = '<style>.drive-connect{display:flex;align-items:center;gap:18px;max-width:720px;padding:28px;border:1px solid var(--line);border-radius:14px;background:linear-gradient(180deg,rgba(20,28,42,.88),rgba(12,17,26,.92))}.drive-connect.error{border-color:rgba(255,141,154,.35)}.drive-logo{display:grid;place-items:center;width:44px;height:44px;border-radius:12px;background:linear-gradient(135deg,#4285f4,#34a853);color:white;font-weight:900;font-size:1.25rem}.drive-connect h2{margin:0;font-size:1.1rem}.drive-connect p{margin:6px 0 15px;color:var(--muted);font-size:.82rem}.drive-toolbar{display:flex;justify-content:space-between;gap:12px;margin:0 0 13px}.drive-toolbar a{color:var(--cyan);font-size:.78rem;font-weight:750}.drive-browser{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:10px}.drive-item{display:grid;gap:8px;min-height:136px;padding:16px;border:1px solid var(--line);border-radius:12px;background:linear-gradient(180deg,rgba(20,28,42,.88),rgba(12,17,26,.92));transition:border-color .15s ease,transform .15s ease}.drive-item:hover{border-color:rgba(55,217,255,.55);transform:translateY(-2px)}.file-icon{display:grid;place-items:center;width:29px;height:29px;border-radius:8px;background:rgba(125,132,151,.15);color:#b7c2d4;font-size:1.1rem}.file-icon.doc{background:rgba(66,133,244,.18);color:#77a7ff}.drive-item.folder .file-icon{background:rgba(255,191,91,.15);color:var(--amber)}.drive-item strong{overflow:hidden;font-size:.82rem;text-overflow:ellipsis;white-space:nowrap}.drive-item small{overflow:hidden;color:var(--muted);font-size:.69rem;text-overflow:ellipsis;white-space:nowrap}.document-panel{padding:0;border:1px solid var(--line);border-radius:13px;background:#fbfcfe;color:#152032;box-shadow:0 18px 50px rgba(0,0,0,.18)}.document-panel pre{max-width:100%;min-height:440px;margin:0;padding:clamp(24px,5vw,58px);overflow:auto;white-space:pre-wrap;font:15px/1.7 ui-serif,Georgia,serif}@media(max-width:760px){.drive-connect{align-items:flex-start;padding:20px}.drive-browser{grid-template-columns:1fr 1fr}.drive-toolbar{flex-wrap:wrap}}@media(max-width:420px){.drive-browser{grid-template-columns:1fr}}</style>';
  const driveControlStyles = '<style>.drive-controls{display:grid;grid-template-columns:minmax(180px,1fr) minmax(120px,.55fr) minmax(140px,.65fr) auto;grid-column:1/-1;gap:9px;align-items:end;padding:13px;border:1px solid var(--line);border-radius:12px;background:rgba(7,12,20,.5)}.drive-controls label{display:grid;gap:4px;color:var(--muted);font-size:.68rem;font-weight:750}.drive-controls input,.drive-controls select{width:100%;min-height:35px;border:1px solid var(--line);border-radius:7px;padding:7px 8px;background:#090e17;color:var(--text);font:inherit;font-size:.76rem}.drive-controls .button{min-height:35px}@media(max-width:760px){.drive-controls{grid-template-columns:1fr 1fr}.drive-controls label:first-of-type{grid-column:1/-1}.drive-controls .button{grid-column:1/-1}.drive-empty{grid-column:1/-1}}</style>';
  const slackStyles = '<style>.slack-controls{display:grid;grid-template-columns:minmax(180px,.48fr) minmax(200px,1fr) auto;gap:9px;align-items:end;margin:0 0 13px;padding:13px;border:1px solid var(--line);border-radius:12px;background:rgba(7,12,20,.5)}.slack-controls label,.slack-compose label,.slack-alerts label{display:grid;gap:4px;color:var(--muted);font-size:.68rem;font-weight:750}.slack-controls input,.slack-controls select,.slack-compose select,.slack-compose textarea,.slack-alerts select{width:100%;min-height:35px;border:1px solid var(--line);border-radius:7px;padding:7px 8px;background:#090e17;color:var(--text);font:inherit;font-size:.76rem}.slack-compose textarea{min-height:100px;resize:vertical}.compose-target{margin:0;color:var(--cyan)!important;font-size:.73rem!important;font-weight:750}.slack-controls .button{min-height:35px}.slack-toolbar{margin-top:17px}.slack-panel,.slack-compose,.slack-alerts{padding:23px;border:1px solid var(--line);border-radius:14px;background:linear-gradient(180deg,rgba(20,28,42,.88),rgba(12,17,26,.92))}.slack-compose,.slack-alerts{display:grid;grid-template-columns:minmax(0,.8fr) minmax(260px,1fr);gap:25px;margin:0 0 12px}.slack-compose h2,.slack-alerts h2{margin:0;font-size:1.13rem}.slack-compose p,.slack-alerts p{margin:6px 0 0;color:var(--muted);font-size:.77rem}.slack-compose form,.slack-alerts form{display:grid;gap:9px}.slack-alerts form{align-content:start}.check-label{grid-template-columns:auto 1fr;align-items:center;gap:8px}.check-label input{width:14px;height:14px;margin:0;accent-color:var(--cyan)}.slack-role-note{margin:0 0 12px}.slack-message{display:grid;grid-template-columns:30px minmax(0,1fr);gap:10px;padding:15px 0;border-top:1px solid var(--line)}.slack-message:first-of-type{padding-top:0;border-top:0}.slack-avatar{display:grid;place-items:center;width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,#4a7fff,#8a53ff);font-size:.72rem;font-weight:850}.slack-message strong{font-size:.82rem}.slack-message time{margin-left:8px;color:var(--dim);font-size:.69rem}.slack-message p{max-width:780px;margin:5px 0 7px;color:#d7dfec;font-size:.8rem;line-height:1.6}.slack-actions{display:flex;gap:13px}.slack-actions a{color:var(--cyan);font-size:.71rem;font-weight:750}@media(max-width:760px){.slack-controls,.slack-compose,.slack-alerts{grid-template-columns:1fr}.slack-controls .button{width:100%}}</style>';
  const workspaceStyles = '<style>.workspace-files-grid{display:grid;grid-template-columns:minmax(300px,.8fr) minmax(0,1.2fr);gap:12px;margin:0 0 26px}.workspace-files-panel{margin-bottom:26px}.workspace-upload form{display:grid;gap:11px;margin-top:17px}.workspace-upload label{display:grid;gap:5px;color:var(--muted);font-size:.7rem;font-weight:750}.workspace-upload label span{color:var(--dim);font-weight:500}.workspace-upload input,.workspace-upload select{width:100%;border:1px solid var(--line);border-radius:8px;padding:9px;background:#090e17;color:var(--text);font:inherit;font-size:.78rem}.workspace-upload input[type=file]{padding:7px}.upload-two{display:grid;grid-template-columns:1fr 1fr;gap:9px}.workspace-file-list{display:grid}.workspace-file{display:grid;grid-template-columns:30px minmax(0,1fr) auto;gap:10px;align-items:center;padding:12px 0;border-top:1px solid var(--line)}.workspace-file:first-child{padding-top:0;border-top:0}.workspace-file-icon{display:grid;place-items:center;width:28px;height:28px;border-radius:8px;background:rgba(71,120,255,.16);color:var(--cyan);font-size:.7rem;font-weight:850;text-transform:uppercase}.workspace-file strong{display:block;overflow:hidden;font-size:.8rem;text-overflow:ellipsis;white-space:nowrap}.workspace-file p,.workspace-file time{margin:1px 0 0;color:var(--muted);font-size:.69rem}.workspace-file-actions{display:grid;justify-items:end;gap:3px}.workspace-file-actions a{color:var(--cyan);font-size:.72rem;font-weight:750}.google-heading{margin-top:8px;margin-bottom:16px}.google-heading h2{margin:0;font-size:1.25rem;letter-spacing:-.03em}.google-heading p{max-width:620px;margin:7px 0 0;color:var(--muted)}@media(max-width:900px){.workspace-files-grid{grid-template-columns:1fr}}@media(max-width:480px){.upload-two{grid-template-columns:1fr}.workspace-file{grid-template-columns:30px minmax(0,1fr)}.workspace-file-actions{grid-column:2;justify-items:start}}</style>';
  const brandedBody = String(body)
    .replaceAll('<span class="brand-mark">PZ</span>', `<span class="brand-mark" ${logoMarkStyle}>${officialLogo}</span>`)
    .replaceAll('<span class="mark">PZ</span>', `<span class="mark" ${logoMarkStyle}>${officialLogo}</span>`)
    .replace('</head>', `${driveStyles}${driveControlStyles}${slackStyles}${workspaceStyles}</head>`);
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
  const query = event.queryStringParameters || {};
  const queryNotice = query.uploaded === '1'
    ? 'Workspace file uploaded and stored privately.'
    : query.connected && selectedView === 'slack'
      ? String(query.connected).slice(0, 180)
      : '';
  let dashboard = await dashboardData(config, accessToken);
  if (query.format === 'activity') {
    return {
      statusCode: 200,
      headers: { ...securityHeaders, 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ activity: dashboard.activity })
    };
  }
  const googleDrive = selectedView === 'media'
    ? await googleDriveBrowser(event.headers || {}, expectedPassword, event.queryStringParameters || {})
    : { state: 'disconnected' };
  const slackSession = selectedView === 'slack'
    ? await slackBrowser(dashboard, event.queryStringParameters || {})
    : { state: 'unregistered' };
  const requestToken = formToken(accessToken, expectedPassword);

  if (form) {
    if (!credentialsMatch(String(form.form_token || ''), requestToken)) return textResponse(403, 'Invalid Console form request. Refresh the page and try again.');
    let result;
    if (form.action === 'register_production') result = await registerProduction(config, accessToken, dashboard, form);
    else if (form.action === 'register_integration') result = await registerIntegration(config, accessToken, dashboard, form);
    else if (form.action === 'post_slack_message') result = await postSlackMessage(config, dashboard, user, form);
    else if (form.action === 'refresh_slack_activity') result = await refreshSlackActivity(dashboard, user);
    else if (form.action === 'save_slack_alert_preferences') result = await saveSlackAlertPreferences(config, accessToken, dashboard, form);
    else return textResponse(400, 'Unsupported Console action.');

    if (result.ok) {
      dashboard = await dashboardData(config, accessToken);
      const message = form.action === 'register_production'
        ? 'Production added. It is available only inside your PostOpz workspace.'
        : form.action === 'register_integration'
          ? 'Pending connection registered. No provider credential has been saved or used.'
          : result.message;
      return responsePage(consolePage(user, dashboard, message, requestToken, selectedView, googleDrive, slackSession));
    }
    return responsePage(consolePage(user, dashboard, result.message, requestToken, selectedView, googleDrive, slackSession));
  }

  return responsePage(consolePage(user, dashboard, queryNotice, requestToken, selectedView, googleDrive, slackSession));
};
