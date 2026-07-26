const crypto = require('crypto');

const SESSION_COOKIE = 'postopz_console_access';
const STATE_COOKIE = 'postopz_google_drive_oauth_state';
const TOKEN_COOKIE = 'postopz_google_drive_oauth_token';
const COOKIE_SECONDS = 600;
const GOOGLE_READ_SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/documents.readonly'
];
const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;
const securityHeaders = {
  'Cache-Control': 'private, no-store, max-age=0',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-Robots-Tag': 'noindex, nofollow, noarchive'
};

function response(statusCode, body, headers = {}) { return { statusCode, headers: { ...securityHeaders, ...headers }, body }; }
function textResponse(statusCode, body, headers = {}) { return response(statusCode, body, { 'Content-Type': 'text/plain; charset=utf-8', ...headers }); }
function escapeHtml(value) { return String(value || '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character])); }
function header(headers, name) { return headers[name] || headers[name.toLowerCase()] || headers[name.toUpperCase()] || ''; }
function safeEqual(actual, expected) { const a = Buffer.from(String(actual), 'utf8'); const b = Buffer.from(String(expected), 'utf8'); return a.length === b.length && crypto.timingSafeEqual(a, b); }
function readCookies(headers) { return (header(headers, 'cookie') || '').split(';').reduce((result, part) => { const index = part.indexOf('='); if (index >= 0) result[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim()); return result; }, {}); }
function cookie(name, value, maxAge = COOKIE_SECONDS) { return `${name}=${encodeURIComponent(value)}; Path=/console; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`; }
function clearCookie(name) { return cookie(name, '', 0); }
function encryptionKey(password) { return crypto.createHash('sha256').update(password, 'utf8').digest(); }
function seal(value, password) { const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(password), iv); const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url'); }
function unseal(value, password) { try { const data = Buffer.from(value, 'base64url'); const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(password), data.subarray(0, 12)); decipher.setAuthTag(data.subarray(12, 28)); return JSON.parse(Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8')); } catch (_) { return null; } }
function requestToken(tokenCookie, password) { return crypto.createHmac('sha256', password).update(tokenCookie, 'utf8').digest('base64url'); }

function hasPrivateGate(event, password) {
  const authorization = header(event.headers || {}, 'authorization');
  if (!authorization.startsWith('Basic ')) return false;
  try { const decoded = Buffer.from(authorization.slice(6), 'base64').toString('utf8'); const index = decoded.indexOf(':'); return index >= 0 && safeEqual(decoded.slice(0, index), 'operator') && safeEqual(decoded.slice(index + 1), password); } catch (_) { return false; }
}

function config() {
  const privateGatePassword = process.env.POSTOPZ_CONSOLE_ALPHA_PASSWORD;
  const clientId = process.env.POSTOPZ_GOOGLE_CLIENT_ID;
  const clientSecret = process.env.POSTOPZ_GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.POSTOPZ_GOOGLE_REDIRECT_URI;
  const connectionId = process.env.POSTOPZ_GOOGLE_CONNECTION_ID;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
  if (!privateGatePassword || !clientId || !clientSecret || !redirectUri || !connectionId || !supabaseUrl || !supabaseKey || !supabaseSecretKey) return null;
  return { privateGatePassword, clientId, clientSecret, redirectUri, connectionId, supabaseUrl: supabaseUrl.replace(/\/$/, ''), supabaseKey, supabaseSecretKey };
}

async function supabase(configured, path, options = {}) {
  const result = await fetch(`${configured.supabaseUrl}${path}`, { method: options.method || 'GET', headers: { apikey: options.accessToken ? configured.supabaseKey : configured.supabaseSecretKey, Authorization: `Bearer ${options.accessToken || configured.supabaseSecretKey}`, ...(options.headers || {}) }, body: options.body });
  const text = await result.text(); let data = null; try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }
  return { ok: result.ok, status: result.status, data };
}

async function currentUser(configured, accessToken) { const result = await supabase(configured, '/auth/v1/user', { accessToken }); return result.ok ? result.data : null; }
async function googleFiles(accessToken) {
  const params = new URLSearchParams({ pageSize: '50', orderBy: 'modifiedTime desc', q: 'trashed = false', fields: 'files(id,name,mimeType,modifiedTime,createdTime,size,webViewLink)' });
  const result = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  const text = await result.text(); let data = null; try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }
  return { ok: result.ok, data };
}

async function googleFile(accessToken, fileId) {
  const params = new URLSearchParams({ fields: 'id,name,mimeType,size' });
  const result = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?${params}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  const text = await result.text(); let data = null; try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }
  return { ok: result.ok, data };
}

async function googleDocument(accessToken, fileId) {
  const result = await fetch(`https://docs.googleapis.com/v1/documents/${encodeURIComponent(fileId)}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  const text = await result.text(); let data = null; try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }
  return { ok: result.ok, data };
}

function documentText(document) {
  return (document.body && document.body.content || []).flatMap((element) => (element.paragraph && element.paragraph.elements || []).map((part) => part.textRun && part.textRun.content || '')).join('').slice(0, 100000);
}

function actionList(files) {
  if (!files.length) return '<p>No accessible Drive files were returned.</p>';
  return `<h2>Recent accessible files</h2><p>Read/download actions are available only for this ten-minute session. Nothing is changed in Google Drive.</p><ul>${files.map((file) => `<li><b>${escapeHtml(file.name || 'Untitled file')}</b><br><small>${escapeHtml(file.mimeType || 'unknown type')} · ${escapeHtml(file.modifiedTime || 'unknown modified time')}</small><br>${file.mimeType === 'application/vnd.google-apps.document' ? `<a href="/console/google/document?file_id=${encodeURIComponent(file.id)}">Read document text</a> · ` : ''}<a href="/console/google/download?file_id=${encodeURIComponent(file.id)}">Download</a></li>`).join('')}</ul>`;
}

function page(title, contents) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>${escapeHtml(title)}</title><style>:root{color-scheme:dark;--bg:#05070b;--panel:#111827;--line:rgba(255,255,255,.12);--text:#f7f9fe;--muted:#a7afbe;--cyan:#00d9ff;--blue:#1976ff;--red:#ff8d8d}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(circle at 84% 0,rgba(25,118,255,.2),transparent 30rem),var(--bg);color:var(--text);font:15px/1.5 Inter,ui-sans-serif,system-ui,sans-serif}.card{width:min(620px,calc(100% - 32px));padding:32px;border:1px solid var(--line);border-radius:20px;background:linear-gradient(180deg,rgba(23,31,47,.96),rgba(10,13,20,.98))}.brand{color:var(--cyan);font-size:.75rem;font-weight:800;letter-spacing:.09em}h1{margin:18px 0 9px;font-size:1.8rem;letter-spacing:-.04em}p{color:var(--muted)}button{margin-top:22px;padding:11px 14px;border:0;border-radius:9px;background:linear-gradient(135deg,var(--blue),#7c3cff);color:#fff;font:700 15px inherit;cursor:pointer}.warning{padding:12px;border:1px solid rgba(255,141,141,.35);border-radius:10px;background:rgba(255,141,141,.08);color:var(--red)}</style></head><body><main class="card"><div class="brand">POSTOPZ CONSOLE · INTERNAL ALPHA</div>${contents}</main></body></html>`;
}

async function authorizedConnection(configured, user) {
  const connection = await supabase(configured, `/rest/v1/integration_connections?id=eq.${encodeURIComponent(configured.connectionId)}&provider=eq.google_drive&select=id,organization_id,configuration`);
  if (!connection.ok || !Array.isArray(connection.data) || connection.data.length !== 1) return null;
  const membership = await supabase(configured, `/rest/v1/organization_members?organization_id=eq.${encodeURIComponent(connection.data[0].organization_id)}&user_id=eq.${encodeURIComponent(user.id)}&select=role`);
  if (!membership.ok || !Array.isArray(membership.data) || !membership.data.some((item) => ['operator', 'admin'].includes(item.role))) return null;
  return connection.data[0];
}

async function recordSnapshot(configured, connection, user, files) {
  const observedAt = new Date().toISOString();
  const resources = files.map((file) => ({ organization_id: connection.organization_id, integration_connection_id: connection.id, provider: 'google_drive', external_id: file.id, resource_type: file.mimeType === 'application/vnd.google-apps.document' ? 'google_document' : 'drive_file', name: String(file.name || 'Untitled file').slice(0, 240), external_url: file.webViewLink || null, metadata: { mime_type: file.mimeType || null, modified_time: file.modifiedTime || null, created_time: file.createdTime || null, size_bytes: file.size || null }, observed_at: observedAt }));
  if (resources.length) {
    const upsert = await supabase(configured, '/rest/v1/external_resources?on_conflict=organization_id,provider,external_id,resource_type', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(resources) });
    if (!upsert.ok) throw new Error('resource-index');
  }
  const sourceEventId = crypto.randomUUID();
  const event = await supabase(configured, '/rest/v1/source_events', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ id: sourceEventId, organization_id: connection.organization_id, integration_connection_id: connection.id, provider: 'google_drive', provider_event_id: `google-drive:snapshot:${observedAt}`, occurred_at: observedAt, payload: { indexed_resource_count: resources.length, scope: 'drive.readonly + documents.readonly' }, payload_sha256: crypto.createHash('sha256').update(resources.map((item) => item.external_id).join('|')).digest('hex') }) });
  if (!event.ok) throw new Error('source-event');
  const activity = await supabase(configured, '/rest/v1/activity_items', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ organization_id: connection.organization_id, source_event_id: sourceEventId, kind: 'document_changed', title: 'Google Drive metadata indexed', detail: `${resources.length} accessible file records indexed (metadata only).`, severity: 'info', occurred_at: observedAt }) });
  if (!activity.ok) throw new Error('activity');
  await Promise.all([
    supabase(configured, `/rest/v1/integration_connections?id=eq.${encodeURIComponent(connection.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'healthy', last_synced_at: observedAt, last_error_at: null, last_error_summary: null, configuration: { ...(connection.configuration || {}), access_mode: 'content_readonly', last_snapshot_count: resources.length } }) }),
    supabase(configured, '/rest/v1/audit_log', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ organization_id: connection.organization_id, actor_id: user.id, action: 'google_drive.snapshot.indexed', entity_type: 'integration_connection', entity_id: connection.id, metadata: { indexed_resource_count: resources.length } }) })
  ]);
}

exports.handler = async (event) => {
  const configured = config();
  if (!configured) return textResponse(503, 'Google Drive setup is waiting for its Netlify connection values.');
  const cookies = readCookies(event.headers || {});
  const mode = (event.queryStringParameters || {}).mode || 'start';
  // Browsers do not consistently resend cached Basic Auth credentials after an
  // external OAuth redirect. The encrypted, short-lived state cookie can carry
  // this single Drive session through its callback/read-only actions; starting
  // a flow still requires Basic Auth and every action still requires the active
  // Console session below.
  const oauthState = cookies[STATE_COOKIE] && unseal(cookies[STATE_COOKIE], configured.privateGatePassword);
  const activeGoogleFlow = mode !== 'start' && oauthState && typeof oauthState.state === 'string';
  if (!hasPrivateGate(event, configured.privateGatePassword) && !activeGoogleFlow) return textResponse(401, 'Authentication is required.', { 'WWW-Authenticate': 'Basic realm="PostOpz Console", charset="UTF-8"' });
  const user = await currentUser(configured, cookies[SESSION_COOKIE]);
  if (!user) return textResponse(401, 'Sign in to Console before connecting Google Drive.');
  if (mode === 'start') {
    const state = crypto.randomBytes(32).toString('base64url'); const authorize = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authorize.searchParams.set('client_id', configured.clientId); authorize.searchParams.set('redirect_uri', configured.redirectUri); authorize.searchParams.set('response_type', 'code'); authorize.searchParams.set('scope', GOOGLE_READ_SCOPES.join(' ')); authorize.searchParams.set('access_type', 'online'); authorize.searchParams.set('prompt', 'select_account'); authorize.searchParams.set('state', state);
    return response(303, '', { Location: authorize.toString(), 'Set-Cookie': cookie(STATE_COOKIE, seal({ state }, configured.privateGatePassword)) });
  }
  if (mode === 'callback') {
    const query = event.queryStringParameters || {}; if (!query.code || !query.state || !oauthState || !safeEqual(query.state, oauthState.state)) return textResponse(400, 'Google authorization could not be verified. Start again from Console.');
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code: query.code, client_id: configured.clientId, client_secret: configured.clientSecret, redirect_uri: configured.redirectUri, grant_type: 'authorization_code' }).toString() });
    const token = await tokenResponse.json().catch(() => null); if (!tokenResponse.ok || !token || !token.access_token) return response(400, page('Google authorization failed', '<h1>Authorization failed</h1><p class="warning">Google did not return a usable access token. Confirm the OAuth client and redirect URI, then try again.</p>'), { 'Content-Type': 'text/html; charset=utf-8', 'Set-Cookie': clearCookie(STATE_COOKIE) });
    const tokenCookie = seal({ accessToken: token.access_token, expiresAt: Date.now() + COOKIE_SECONDS * 1000 }, configured.privateGatePassword); const drive = await googleFiles(token.access_token);
    const files = drive.ok && Array.isArray(drive.data && drive.data.files) ? drive.data.files : [];
    const connection = await authorizedConnection(configured, user);
    if (connection && drive.ok) { try { await recordSnapshot(configured, connection, user, files); } catch (_) { /* Browsing remains available if metadata indexing is temporarily unavailable. */ } }
    return response(303, '', { Location: '/console?view=media&google=connected', 'Set-Cookie': cookie(TOKEN_COOKIE, tokenCookie) });
  }
  if (mode === 'document' || mode === 'download') {
    const tokenCookie = cookies[TOKEN_COOKIE]; const token = tokenCookie && unseal(tokenCookie, configured.privateGatePassword); const fileId = String((event.queryStringParameters || {}).file_id || '');
    if (!token || token.expiresAt < Date.now() || !/^[A-Za-z0-9_-]{3,200}$/.test(fileId)) return textResponse(400, 'Google authorization has expired. Start again from Console.');
    if (!await authorizedConnection(configured, user)) return textResponse(403, 'This Console account cannot use the Google Drive connection.');
    const file = await googleFile(token.accessToken, fileId); if (!file.ok || !file.data) return textResponse(404, 'Google Drive file was not found or is not accessible.');
    if (mode === 'document') {
      if (file.data.mimeType !== 'application/vnd.google-apps.document') return textResponse(400, 'This action is available for Google Docs only.');
      const document = await googleDocument(token.accessToken, fileId); if (!document.ok || !document.data) return textResponse(400, 'Google Docs could not return this document.');
      return response(200, page('Read Google Doc', `<h1>${escapeHtml(file.data.name || 'Google Doc')}</h1><p>Read-only session. Document contents are not retained in Console.</p><pre>${escapeHtml(documentText(document.data))}</pre><p><a href="/console/google/connect">Start a new Drive session</a></p>`), { 'Content-Type': 'text/html; charset=utf-8' });
    }
    if (Number(file.data.size || 0) > MAX_DOWNLOAD_BYTES) return textResponse(413, 'This file is over the alpha download limit of 25 MB. Download it directly from Google Drive.');
    const isGoogleDocument = file.data.mimeType === 'application/vnd.google-apps.document';
    const url = isGoogleDocument
      ? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent('application/pdf')}`
      : `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
    const download = await fetch(url, { headers: { Authorization: `Bearer ${token.accessToken}` } });
    const length = Number(download.headers.get('content-length') || 0); if (!download.ok || length > MAX_DOWNLOAD_BYTES) return textResponse(413, 'Google could not provide this download within the 25 MB alpha limit.');
    const data = Buffer.from(await download.arrayBuffer()); if (data.length > MAX_DOWNLOAD_BYTES) return textResponse(413, 'Google could not provide this download within the 25 MB alpha limit.');
    const filename = String(file.data.name || 'download').replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 120) + (isGoogleDocument ? '.pdf' : '');
    return { statusCode: 200, isBase64Encoded: true, headers: { ...securityHeaders, 'Content-Type': isGoogleDocument ? 'application/pdf' : (download.headers.get('content-type') || 'application/octet-stream'), 'Content-Disposition': `attachment; filename="${filename}"` }, body: data.toString('base64') };
  }
  if (mode === 'index' && event.httpMethod === 'POST') {
    const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : (event.body || ''); const form = Object.fromEntries(new URLSearchParams(raw)); const tokenCookie = cookies[TOKEN_COOKIE]; const token = tokenCookie && unseal(tokenCookie, configured.privateGatePassword);
    if (!token || token.expiresAt < Date.now() || !safeEqual(form.request_token || '', requestToken(tokenCookie, configured.privateGatePassword))) return textResponse(400, 'Google authorization has expired. Start again from Console.');
    const connection = await authorizedConnection(configured, user); if (!connection) return textResponse(403, 'This Console account cannot update the Google Drive connection.');
    const drive = await googleFiles(token.accessToken); if (!drive.ok) return response(400, page('Google Drive snapshot failed', '<h1>Metadata snapshot failed</h1><p class="warning">Google Drive did not return accessible metadata. Confirm that this Google account has Drive access, then start again.</p>'), { 'Content-Type': 'text/html; charset=utf-8', 'Set-Cookie': clearCookie(TOKEN_COOKIE) });
    try { await recordSnapshot(configured, connection, user, Array.isArray(drive.data && drive.data.files) ? drive.data.files : []); } catch (_) { return textResponse(500, 'Console could not record the Google Drive metadata snapshot.'); }
    return response(200, page('Google Drive metadata indexed', `<h1>Metadata index complete</h1><p>${Array.isArray(drive.data && drive.data.files) ? drive.data.files.length : 0} accessible file records were indexed. Console stored metadata only; no Google file or document content was read or changed.</p><p><a href="/console">Return to Console</a></p>`), { 'Content-Type': 'text/html; charset=utf-8', 'Set-Cookie': clearCookie(TOKEN_COOKIE) });
  }
  return textResponse(404, 'Not found.');
};
