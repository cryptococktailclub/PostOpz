const crypto = require('crypto');

const SESSION_COOKIE = 'postopz_console_access';
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const DOCUMENT_TYPES = new Set(['brief', 'script', 'turnover', 'edl', 'xml', 'delivery_spec', 'call_sheet', 'schedule', 'other']);
const ALLOWED_EXTENSIONS = new Set(['pdf', 'txt', 'csv', 'edl', 'xml', 'json', 'doc', 'docx', 'xls', 'xlsx']);
const securityHeaders = {
  'Cache-Control': 'private, no-store, max-age=0',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-Robots-Tag': 'noindex, nofollow, noarchive'
};

function response(statusCode, body, headers = {}) { return { statusCode, headers: { ...securityHeaders, ...headers }, body }; }
function text(statusCode, body, headers = {}) { return response(statusCode, body, { 'Content-Type': 'text/plain; charset=utf-8', ...headers }); }
function header(headers, name) { return headers[name] || headers[name.toLowerCase()] || headers[name.toUpperCase()] || ''; }
function cookies(headers) { return (header(headers, 'cookie') || '').split(';').reduce((result, part) => { const index = part.indexOf('='); if (index >= 0) result[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim()); return result; }, {}); }
function safeEqual(actual, expected) { const left = Buffer.from(String(actual || ''), 'utf8'); const right = Buffer.from(String(expected || ''), 'utf8'); return left.length === right.length && crypto.timingSafeEqual(left, right); }
function formToken(accessToken, password) { return crypto.createHmac('sha256', password).update(accessToken, 'utf8').digest('base64url'); }
function basicGate(event, password) { const authorization = header(event.headers || {}, 'authorization'); if (!authorization.startsWith('Basic ')) return false; try { const decoded = Buffer.from(authorization.slice(6), 'base64').toString('utf8'); const index = decoded.indexOf(':'); return index >= 0 && safeEqual(decoded.slice(0, index), 'operator') && safeEqual(decoded.slice(index + 1), password); } catch (_) { return false; } }
function config() { const password = process.env.POSTOPZ_CONSOLE_ALPHA_PASSWORD; const url = process.env.SUPABASE_URL; const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY; const secretKey = process.env.SUPABASE_SECRET_KEY; const slackBotToken = process.env.POSTOPZ_SLACK_BOT_TOKEN || null; return password && url && publishableKey && secretKey ? { password, url: url.replace(/\/$/, ''), publishableKey, secretKey, slackBotToken } : null; }

async function supabase(configured, path, options = {}) {
  const key = options.accessToken ? configured.publishableKey : configured.secretKey;
  const result = await fetch(`${configured.url}${path}`, { method: options.method || 'GET', headers: { apikey: key, Authorization: `Bearer ${options.accessToken || configured.secretKey}`, ...(options.headers || {}) }, body: options.body });
  const body = await result.text(); let data = null; try { data = body ? JSON.parse(body) : null; } catch (_) { data = null; }
  return { ok: result.ok, status: result.status, data };
}

async function currentUser(configured, accessToken) { const result = await supabase(configured, '/auth/v1/user', { accessToken }); return result.ok && result.data && result.data.id ? result.data : null; }
async function canOperate(configured, organizationId, userId) { const result = await supabase(configured, `/rest/v1/organization_members?organization_id=eq.${encodeURIComponent(organizationId)}&user_id=eq.${encodeURIComponent(userId)}&select=role`); return result.ok && Array.isArray(result.data) && result.data.some((member) => ['operator', 'admin'].includes(member.role)); }
async function canAccessProduction(configured, productionId, userId) { if (!productionId) return false; const result = await supabase(configured, `/rest/v1/production_members?production_id=eq.${encodeURIComponent(productionId)}&user_id=eq.${encodeURIComponent(userId)}&select=role`); return result.ok && Array.isArray(result.data) && result.data.length > 0; }
function safeFileName(value) { return String(value || 'upload').replace(/[^A-Za-z0-9._ -]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 180) || 'upload'; }
function objectPath(path) { return path.split('/').map(encodeURIComponent).join('/'); }

function parseMultipart(event) {
  const contentType = header(event.headers || {}, 'content-type'); const match = contentType.match(/boundary=(?:"([^"]+)"|([^;\s]+))/i); if (!match) return null;
  const boundary = `--${match[1] || match[2]}`; const source = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64') : Buffer.from(event.body || '', 'latin1');
  const parts = source.toString('latin1').split(boundary); const fields = {}; let file = null;
  for (const rawPart of parts.slice(1, -1)) {
    const part = rawPart.replace(/^\r\n/, ''); const separator = part.indexOf('\r\n\r\n'); if (separator < 0) continue;
    const headers = part.slice(0, separator); let content = part.slice(separator + 4); if (content.endsWith('\r\n')) content = content.slice(0, -2);
    const disposition = headers.match(/content-disposition:\s*form-data;\s*name="([^"]+)"(?:;\s*filename="([^"]*)")?/i); if (!disposition) continue;
    const name = disposition[1]; const filename = disposition[2]; const type = (headers.match(/content-type:\s*([^\r\n]+)/i) || [])[1] || 'application/octet-stream';
    if (filename !== undefined) file = { filename, contentType: type.trim().toLowerCase(), data: Buffer.from(content, 'latin1') }; else fields[name] = content;
  }
  return { fields, file };
}

async function notifySlackWorkspaceFileUpload(configured, organizationId, user, file) {
  if (!configured.slackBotToken) return;
  try {
    const connection = await supabase(configured, `/rest/v1/integration_connections?organization_id=eq.${encodeURIComponent(organizationId)}&provider=eq.slack&select=id,configuration&limit=1`);
    const record = connection.ok && Array.isArray(connection.data) && connection.data[0];
    const configuration = record && record.configuration || {};
    const alerts = configuration.alerts || {};
    const allowed = Array.isArray(configuration.selected_channel_ids) ? configuration.selected_channel_ids : [];
    const channelId = alerts.workspace_file_uploaded_channel_id;
    if (!record || !alerts.workspace_file_uploaded || !allowed.includes(channelId)) return;
    const label = String(file.document_type || 'other').replaceAll('_', ' ');
    const message = `PostOpz Console: ${user.email || 'A Console operator'} uploaded ${file.file_name} (${label}${file.version_label ? ` · ${file.version_label}` : ''}) to Workspace Files.`;
    const posted = await fetch('https://slack.com/api/chat.postMessage', { method: 'POST', headers: { Authorization: `Bearer ${configured.slackBotToken}`, 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify({ channel: channelId, text: message }) });
    const result = await posted.json().catch(() => null);
    if (!posted.ok || !result || !result.ok) return;
    await supabase(configured, '/rest/v1/audit_log', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ organization_id: organizationId, actor_id: user.id, action: 'slack.workspace_file_alert.posted', entity_type: 'workspace_file', entity_id: file.id, metadata: { channel_id: channelId, message_ts: result.ts || null } }) });
  } catch (_) { /* A notification failure must not affect the uploaded document. */ }
}

async function upload(configured, event, user, accessToken) {
  const form = parseMultipart(event); if (!form || !form.file) return text(400, 'Choose a document to upload.');
  if (!safeEqual(form.fields.form_token || '', formToken(accessToken, configured.password))) return text(403, 'Invalid upload request. Refresh Workspace Files and try again.');
  const organizationId = String(form.fields.organization_id || ''); const productionId = String(form.fields.production_id || ''); const documentType = String(form.fields.document_type || 'other'); const versionLabel = String(form.fields.version_label || '').trim().slice(0, 80);
  if (!/^[0-9a-f-]{36}$/i.test(organizationId) || !DOCUMENT_TYPES.has(documentType)) return text(400, 'Choose a workspace and document type.');
  if (productionId && !/^[0-9a-f-]{36}$/i.test(productionId)) return text(400, 'Invalid production selection.');
  if (!await canOperate(configured, organizationId, user.id)) return text(403, 'This Console account cannot upload to that workspace.');
  if (form.file.data.length < 1 || form.file.data.length > MAX_UPLOAD_BYTES) return text(413, 'Workspace Files accepts documents up to 5 MB in this alpha.');
  const name = safeFileName(form.file.filename); const extension = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  if (!ALLOWED_EXTENSIONS.has(extension)) return text(415, 'This alpha accepts PDF, text, CSV, EDL, XML, JSON, Word, and Excel documents only.');
  if (productionId) { const production = await supabase(configured, `/rest/v1/productions?id=eq.${encodeURIComponent(productionId)}&organization_id=eq.${encodeURIComponent(organizationId)}&select=id`); if (!production.ok || !Array.isArray(production.data) || production.data.length !== 1) return text(400, 'That production is not in the selected workspace.'); }
  const storagePath = `${organizationId}/${productionId || 'unassigned'}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${name}`;
  const stored = await fetch(`${configured.url}/storage/v1/object/console-workspace-files/${objectPath(storagePath)}`, { method: 'POST', headers: { apikey: configured.secretKey, Authorization: `Bearer ${configured.secretKey}`, 'Content-Type': form.file.contentType, 'x-upsert': 'false' }, body: form.file.data });
  if (!stored.ok) return text(502, 'Console could not store that document.');
  const saved = await supabase(configured, '/rest/v1/workspace_files', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify({ organization_id: organizationId, production_id: productionId || null, storage_path: storagePath, file_name: name, content_type: form.file.contentType, size_bytes: form.file.data.length, document_type: documentType, version_label: versionLabel || null, uploaded_by: user.id }) });
  if (!saved.ok || !Array.isArray(saved.data) || !saved.data[0]) return text(500, 'The document was stored but its Console record could not be created. Contact an administrator before uploading it again.');
  await supabase(configured, '/rest/v1/audit_log', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ organization_id: organizationId, actor_id: user.id, action: 'workspace_file.uploaded', entity_type: 'workspace_file', entity_id: saved.data[0].id, metadata: { file_name: name, document_type: documentType, size_bytes: form.file.data.length } }) });
  await notifySlackWorkspaceFileUpload(configured, organizationId, user, saved.data[0]);
  return response(303, '', { Location: '/console?view=media&uploaded=1' });
}

async function download(configured, event, user) {
  const id = String((event.queryStringParameters || {}).id || ''); if (!/^[0-9a-f-]{36}$/i.test(id)) return text(400, 'Invalid workspace file.');
  const file = await supabase(configured, `/rest/v1/workspace_files?id=eq.${encodeURIComponent(id)}&select=id,organization_id,production_id,storage_path,file_name`); if (!file.ok || !Array.isArray(file.data) || file.data.length !== 1) return text(404, 'Workspace file not found.');
  const canDownload = await canOperate(configured, file.data[0].organization_id, user.id) || await canAccessProduction(configured, file.data[0].production_id, user.id);
  if (!canDownload) return text(403, 'This Console account cannot download that workspace file.');
  const signed = await supabase(configured, `/storage/v1/object/sign/console-workspace-files/${objectPath(file.data[0].storage_path)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: 60, download: file.data[0].file_name }) });
  if (!signed.ok || !signed.data || !signed.data.signedURL) return text(502, 'Console could not prepare that download.');
  return response(303, '', { Location: `${configured.url}/storage/v1${signed.data.signedURL}` });
}

exports.handler = async (event) => {
  const configured = config(); if (!configured) return text(503, 'Workspace Files is waiting for its Netlify connection values.');
  if (!basicGate(event, configured.password)) return text(401, 'Authentication is required.', { 'WWW-Authenticate': 'Basic realm="PostOpz Console", charset="UTF-8"' });
  const accessToken = cookies(event.headers || {})[SESSION_COOKIE]; const user = await currentUser(configured, accessToken); if (!user) return text(401, 'Sign in to Console before using Workspace Files.');
  const mode = (event.queryStringParameters || {}).mode || '';
  if (mode === 'upload' && event.httpMethod === 'POST') return upload(configured, event, user, accessToken);
  if (mode === 'download' && event.httpMethod === 'GET') return download(configured, event, user);
  return text(404, 'Not found.');
};
