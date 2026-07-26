const crypto = require('crypto');

const SESSION_COOKIE = 'postopz_console_access';
const STATE_COOKIE = 'postopz_frameio_oauth_state';
const TOKEN_COOKIE = 'postopz_frameio_oauth_token';
const COOKIE_SECONDS = 600;
const securityHeaders = {
  'Cache-Control': 'private, no-store, max-age=0',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-Robots-Tag': 'noindex, nofollow, noarchive'
};

function response(statusCode, body, headers = {}) {
  return { statusCode, headers: { ...securityHeaders, ...headers }, body };
}

function textResponse(statusCode, body, headers = {}) {
  return response(statusCode, body, { 'Content-Type': 'text/plain; charset=utf-8', ...headers });
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

function getHeader(headers, name) {
  return headers[name] || headers[name.toLowerCase()] || headers[name.toUpperCase()] || '';
}

function readCookies(headers) {
  return (getHeader(headers, 'cookie') || '').split(';').reduce((cookies, part) => {
    const separator = part.indexOf('=');
    if (separator < 0) return cookies;
    cookies[part.slice(0, separator).trim()] = decodeURIComponent(part.slice(separator + 1).trim());
    return cookies;
  }, {});
}

function parseForm(event) {
  const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : (event.body || '');
  return Object.fromEntries(new URLSearchParams(raw));
}

function credentialsMatch(actual, expected) {
  const received = Buffer.from(String(actual), 'utf8');
  const required = Buffer.from(String(expected), 'utf8');
  return received.length === required.length && crypto.timingSafeEqual(received, required);
}

function hasPrivateGate(event, expectedPassword) {
  const authorization = getHeader(event.headers || {}, 'authorization');
  if (!authorization.startsWith('Basic ')) return false;
  try {
    const decoded = Buffer.from(authorization.slice(6), 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    return separator >= 0 && credentialsMatch(decoded.slice(0, separator), 'operator') && credentialsMatch(decoded.slice(separator + 1), expectedPassword);
  } catch (_) {
    return false;
  }
}

function privateGateRequired() {
  return textResponse(401, 'Authentication is required.', { 'WWW-Authenticate': 'Basic realm="PostOpz Console", charset="UTF-8"' });
}

function cookie(name, value, maxAge = COOKIE_SECONDS) {
  return `${name}=${encodeURIComponent(value)}; Path=/console/frameio; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function clearCookie(name) {
  return cookie(name, '', 0);
}

function encryptionKey(password) {
  return crypto.createHash('sha256').update(password, 'utf8').digest();
}

function seal(value, password) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(password), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
}

function unseal(value, password) {
  try {
    const data = Buffer.from(value, 'base64url');
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(password), data.subarray(0, 12));
    decipher.setAuthTag(data.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8'));
  } catch (_) {
    return null;
  }
}

function requestToken(tokenCookie, password) {
  return crypto.createHmac('sha256', password).update(tokenCookie, 'utf8').digest('base64url');
}

function config() {
  const privateGatePassword = process.env.POSTOPZ_CONSOLE_ALPHA_PASSWORD;
  const clientId = process.env.POSTOPZ_FRAMEIO_CLIENT_ID;
  const clientSecret = process.env.POSTOPZ_FRAMEIO_CLIENT_SECRET;
  const redirectUri = process.env.POSTOPZ_FRAMEIO_REDIRECT_URI;
  const connectionId = process.env.POSTOPZ_FRAMEIO_CONNECTION_ID;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
  if (!privateGatePassword || !clientId || !clientSecret || !redirectUri || !connectionId || !supabaseUrl || !supabaseKey || !supabaseSecretKey) return null;
  return {
    privateGatePassword, clientId, clientSecret, redirectUri, connectionId,
    supabaseUrl: supabaseUrl.replace(/\/$/, ''), supabaseKey, supabaseSecretKey,
    scopes: process.env.POSTOPZ_FRAMEIO_OAUTH_SCOPES || 'openid'
  };
}

async function supabaseUser(configured, accessToken) {
  const result = await fetch(`${configured.supabaseUrl}/auth/v1/user`, { headers: { apikey: configured.supabaseKey, Authorization: `Bearer ${accessToken}` } });
  return result.ok ? result.json() : null;
}

async function supabaseRequest(configured, path, options = {}) {
  const result = await fetch(`${configured.supabaseUrl}${path}`, {
    method: options.method || 'GET',
    headers: { apikey: configured.supabaseSecretKey, Authorization: `Bearer ${configured.supabaseSecretKey}`, ...(options.headers || {}) },
    body: options.body
  });
  const text = await result.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch (_) { data = null; } }
  return { ok: result.ok, status: result.status, data };
}

async function frameRequest(accessToken, path, options = {}) {
  const result = await fetch(`https://api.frame.io${path}`, {
    method: options.method || 'GET',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
    body: options.body
  });
  const text = await result.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch (_) { data = null; } }
  return { ok: result.ok, status: result.status, data };
}

function collection(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data && data.data)) return data.data;
  return [];
}

function oauthPage(title, content) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>${escapeHtml(title)}</title><style>:root{color-scheme:dark;--bg:#05070b;--panel:#111827;--line:rgba(255,255,255,.12);--text:#f7f9fe;--muted:#a7afbe;--cyan:#00d9ff;--blue:#1976ff;--red:#ff8d8d}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(circle at 84% 0,rgba(25,118,255,.2),transparent 30rem),var(--bg);color:var(--text);font:15px/1.5 Inter,ui-sans-serif,system-ui,sans-serif}.card{width:min(620px,calc(100% - 32px));padding:32px;border:1px solid var(--line);border-radius:20px;background:linear-gradient(180deg,rgba(23,31,47,.96),rgba(10,13,20,.98))}.brand{color:var(--cyan);font-size:.75rem;font-weight:800;letter-spacing:.09em}h1{margin:18px 0 9px;font-size:1.8rem;letter-spacing:-.04em}p{color:var(--muted)}label{display:grid;gap:6px;margin-top:18px;color:var(--muted);font-size:.8rem;font-weight:700}select{width:100%;padding:11px;border:1px solid var(--line);border-radius:9px;background:#090d15;color:var(--text);font:inherit}button{margin-top:22px;padding:11px 14px;border:0;border-radius:9px;background:linear-gradient(135deg,var(--blue),#7c3cff);color:#fff;font:700 15px inherit;cursor:pointer}.warning{padding:12px;border:1px solid rgba(255,141,141,.35);border-radius:10px;background:rgba(255,141,141,.08);color:var(--red)}</style></head><body><main class="card"><div class="brand">POSTOPZ CONSOLE · INTERNAL ALPHA</div>${content}</main></body></html>`;
}

async function workspacesForToken(accessToken) {
  const accountsResult = await frameRequest(accessToken, '/v4/accounts');
  if (!accountsResult.ok) return [];
  const accounts = collection(accountsResult.data);
  const groups = await Promise.all(accounts.map(async (account) => {
    const accountId = account.id;
    if (!accountId) return [];
    const workspaces = await frameRequest(accessToken, `/v4/accounts/${encodeURIComponent(accountId)}/workspaces`);
    return collection(workspaces.data).map((workspace) => ({ accountId, accountName: account.name || accountId, workspaceId: workspace.id, workspaceName: workspace.name || workspace.id }));
  }));
  return groups.flat().filter((workspace) => workspace.workspaceId);
}

exports.handler = async (event) => {
  const configured = config();
  if (!configured) return textResponse(503, 'Frame.io OAuth is waiting for its Netlify connection values.');
  if (!hasPrivateGate(event, configured.privateGatePassword)) return privateGateRequired();
  const cookies = readCookies(event.headers || {});
  const user = await supabaseUser(configured, cookies[SESSION_COOKIE]);
  if (!user) return textResponse(401, 'Sign in to Console before connecting Frame.io.');
  const mode = (event.queryStringParameters || {}).mode || 'start';

  if (mode === 'start') {
    const state = crypto.randomBytes(32).toString('base64url');
    const authorize = new URL('https://ims-na1.adobelogin.com/ims/authorize/v2');
    authorize.searchParams.set('client_id', configured.clientId);
    authorize.searchParams.set('redirect_uri', configured.redirectUri);
    authorize.searchParams.set('scope', configured.scopes);
    authorize.searchParams.set('state', state);
    authorize.searchParams.set('response_type', 'code');
    // Make the operator choose the Adobe identity tied to the beta-user entry
    // rather than silently reusing a stale browser session.
    authorize.searchParams.set('prompt', 'login');
    return response(303, '', { Location: authorize.toString(), 'Set-Cookie': cookie(STATE_COOKIE, state) });
  }

  if (mode === 'callback') {
    const query = event.queryStringParameters || {};
    if (!query.code || !query.state || !cookies[STATE_COOKIE] || !credentialsMatch(query.state, cookies[STATE_COOKIE])) return textResponse(400, 'Frame.io authorization could not be verified. Start again from Console.');
    const basic = Buffer.from(`${configured.clientId}:${configured.clientSecret}`, 'utf8').toString('base64');
    const tokenResponse = await fetch('https://ims-na1.adobelogin.com/ims/token/v3', {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code: query.code, grant_type: 'authorization_code' }).toString()
    });
    const tokenData = await tokenResponse.json().catch(() => null);
    if (!tokenResponse.ok || !tokenData || !tokenData.access_token) return response(400, oauthPage('Frame.io authorization failed', '<h1>Authorization failed</h1><p class="warning">Adobe did not return a usable access token. Confirm the redirect URI and Adobe project configuration, then try again.</p>'), { 'Content-Type': 'text/html; charset=utf-8', 'Set-Cookie': clearCookie(STATE_COOKIE) });
    const workspaces = await workspacesForToken(tokenData.access_token);
    if (!workspaces.length) return response(400, oauthPage('No Frame.io workspace available', '<h1>No Frame.io workspace found</h1><p class="warning">The authorized Adobe user has no available Frame.io V4 workspace. Check the Frame.io account type and the user’s workspace role.</p>'), { 'Content-Type': 'text/html; charset=utf-8', 'Set-Cookie': clearCookie(STATE_COOKIE) });
    const tokenCookie = seal({ accessToken: tokenData.access_token, expiresAt: Date.now() + COOKIE_SECONDS * 1000 }, configured.privateGatePassword);
    const options = workspaces.map((workspace) => `<option value="${escapeHtml(`${workspace.accountId}|${workspace.workspaceId}`)}">${escapeHtml(`${workspace.accountName} — ${workspace.workspaceName}`)}</option>`).join('');
    const content = `<h1>Choose the Frame.io workspace</h1><p>Console will create one signed, event-only webhook in this workspace. It will subscribe only to file-ready/upload-complete events, comment activity, and project changes.</p><form method="post" action="/console/frameio/select-workspace"><input type="hidden" name="request_token" value="${escapeHtml(requestToken(tokenCookie, configured.privateGatePassword))}"><label>Workspace<select name="workspace" required>${options}</select></label><button type="submit">Create protected webhook</button></form>`;
    return response(200, oauthPage('Choose Frame.io workspace', content), { 'Content-Type': 'text/html; charset=utf-8', 'Set-Cookie': cookie(TOKEN_COOKIE, tokenCookie) });
  }

  if (mode === 'select' && event.httpMethod === 'POST') {
    const form = parseForm(event);
    const tokenCookie = cookies[TOKEN_COOKIE];
    const token = tokenCookie && unseal(tokenCookie, configured.privateGatePassword);
    if (!token || !token.accessToken || token.expiresAt < Date.now() || !credentialsMatch(form.request_token || '', requestToken(tokenCookie, configured.privateGatePassword))) return textResponse(400, 'The Frame.io authorization has expired. Start again from Console.');
    const [accountId, workspaceId] = String(form.workspace || '').split('|');
    if (!accountId || !workspaceId) return textResponse(400, 'Choose a Frame.io workspace.');
    const webhookUrl = `${new URL(configured.redirectUri).origin}/console/webhooks/frameio`;
    const create = await frameRequest(token.accessToken, `/v4/accounts/${encodeURIComponent(accountId)}/workspaces/${encodeURIComponent(workspaceId)}/webhooks`, {
      method: 'POST',
      body: JSON.stringify({ data: { name: 'PostOpz Console — Internal Alpha', url: webhookUrl, events: ['file.ready', 'file.upload.completed', 'comment.created', 'comment.completed', 'project.created', 'project.updated'] } })
    });
    const webhook = create.data && (create.data.data || create.data);
    const signingSecret = webhook && (webhook.signing_secret || webhook.signingSecret || webhook.secret);
    if (!create.ok || !webhook || !signingSecret) return response(400, oauthPage('Webhook creation needs attention', '<h1>Webhook was not completed</h1><p class="warning">Frame.io did not return a signing secret. No Console receiver has been activated. Check the Frame.io API response and try again.</p>'), { 'Content-Type': 'text/html; charset=utf-8', 'Set-Cookie': clearCookie(TOKEN_COOKIE) });
    const connection = await supabaseRequest(configured, `/rest/v1/integration_connections?id=eq.${encodeURIComponent(configured.connectionId)}&provider=eq.frame_io&select=id,organization_id,configuration`);
    if (!connection.ok || !Array.isArray(connection.data) || connection.data.length !== 1) return textResponse(500, 'Console could not locate the Frame.io connection record.');
    const existing = connection.data[0].configuration || {};
    await Promise.all([
      supabaseRequest(configured, `/rest/v1/integration_connections?id=eq.${encodeURIComponent(configured.connectionId)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'pending', configuration: { ...existing, account_id: accountId, workspace_id: workspaceId, webhook_id: webhook.id || null, webhook_url: webhookUrl } }) }),
      supabaseRequest(configured, '/rest/v1/audit_log', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ organization_id: connection.data[0].organization_id, actor_id: user.id, action: 'frameio.webhook.created', entity_type: 'integration_connection', entity_id: configured.connectionId, metadata: { account_id: accountId, workspace_id: workspaceId, webhook_id: webhook.id || null } }) })
    ]);
    const content = `<h1>Frame.io webhook created</h1><p>Copy this one-time signing secret directly into Netlify as <code>POSTOPZ_FRAMEIO_WEBHOOK_SECRET</code>. It is not stored in Supabase or Console.</p><p class="warning"><b>Copy now:</b><br><code>${escapeHtml(signingSecret)}</code><br><br>After saving it in Netlify for Deploy Previews, trigger a fresh deploy and create a noncritical Frame.io test event.</p><p>Then return to <a href="/console">Console</a> to confirm the verified activity appears.</p>`;
    return response(200, oauthPage('Frame.io webhook created', content), { 'Content-Type': 'text/html; charset=utf-8', 'Set-Cookie': clearCookie(TOKEN_COOKIE) });
  }

  return textResponse(404, 'Not found.');
};
