const crypto = require('crypto');
const shared = require('./slack-shared');

const STATE_COOKIE = 'postopz_slack_oauth_state';
const TOKEN_COOKIE = 'postopz_slack_oauth_token';
const securityHeaders = { 'Cache-Control': 'private, no-store, max-age=0', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'", 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'X-Robots-Tag': 'noindex, nofollow, noarchive' };
function response(statusCode, body, headers = {}) { return { statusCode, headers: { ...securityHeaders, ...headers }, body }; }
function textResponse(statusCode, body, headers = {}) { return response(statusCode, body, { 'Content-Type': 'text/plain; charset=utf-8', ...headers }); }
function escapeHtml(value) { return String(value || '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character])); }
function hasPrivateGate(event, password) { const authorization = shared.header(event.headers || {}, 'authorization'); if (!authorization.startsWith('Basic ')) return false; try { const decoded = Buffer.from(authorization.slice(6), 'base64').toString('utf8'); const separator = decoded.indexOf(':'); return separator >= 0 && shared.safeEqual(decoded.slice(0, separator), 'operator') && shared.safeEqual(decoded.slice(separator + 1), password); } catch (_) { return false; } }
function page(title, contents) { return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>${escapeHtml(title)}</title><style>:root{color-scheme:dark;--bg:#05070b;--panel:#111827;--line:rgba(255,255,255,.12);--text:#f7f9fe;--muted:#a7afbe;--cyan:#00d9ff;--blue:#1976ff;--red:#ff8d8d}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(circle at 84% 0,rgba(25,118,255,.2),transparent 30rem),var(--bg);color:var(--text);font:15px/1.5 Inter,ui-sans-serif,system-ui,sans-serif}.card{width:min(680px,calc(100% - 32px));padding:32px;border:1px solid var(--line);border-radius:20px;background:linear-gradient(180deg,rgba(23,31,47,.96),rgba(10,13,20,.98))}.brand{color:var(--cyan);font-size:.75rem;font-weight:800;letter-spacing:.09em}h1{margin:18px 0 9px;font-size:1.8rem;letter-spacing:-.04em}p,li{color:var(--muted)}label{display:grid;gap:6px;margin-top:18px;color:var(--muted);font-size:.8rem;font-weight:700}select{width:100%;min-height:180px;padding:11px;border:1px solid var(--line);border-radius:9px;background:#090d15;color:var(--text);font:inherit}button{margin-top:22px;padding:11px 14px;border:0;border-radius:9px;background:linear-gradient(135deg,var(--blue),#7c3cff);color:#fff;font:700 15px inherit;cursor:pointer}.warning{padding:12px;border:1px solid rgba(255,141,141,.35);border-radius:10px;background:rgba(255,141,141,.08);color:var(--red)}code{word-break:break-all;color:#d8e5ff}</style></head><body><main class="card"><div class="brand">POSTOPZ CONSOLE · INTERNAL ALPHA</div>${contents}</main></body></html>`; }

exports.handler = async (event) => {
  const configured = shared.config();
  if (!configured || !configured.clientId || !configured.clientSecret || !configured.redirectUri || !configured.connectionId) return textResponse(503, 'Slack setup is waiting for its Netlify connection values.');
  const cookies = shared.readCookies(event.headers || {});
  const mode = (event.queryStringParameters || {}).mode || 'start';
  const oauthState = cookies[STATE_COOKIE] && shared.unseal(cookies[STATE_COOKIE], configured.privateGatePassword);
  const activeFlow = mode !== 'start' && oauthState && typeof oauthState.state === 'string';
  if (!hasPrivateGate(event, configured.privateGatePassword) && !activeFlow) return textResponse(401, 'Authentication is required.', { 'WWW-Authenticate': 'Basic realm="PostOpz Console", charset="UTF-8"' });
  const user = await shared.currentUser(configured, cookies[shared.SESSION_COOKIE]);
  if (!user) return textResponse(401, 'Sign in to Console before connecting Slack.');

  if (mode === 'start') {
    const state = crypto.randomBytes(32).toString('base64url');
    const authorize = new URL('https://slack.com/oauth/v2/authorize');
    authorize.searchParams.set('client_id', configured.clientId);
    authorize.searchParams.set('redirect_uri', configured.redirectUri);
    authorize.searchParams.set('scope', 'channels:read,channels:history,chat:write');
    authorize.searchParams.set('state', state);
    return response(303, '', { Location: authorize.toString(), 'Set-Cookie': shared.cookie(STATE_COOKIE, shared.seal({ state }, configured.privateGatePassword)) });
  }

  if (mode === 'callback') {
    const query = event.queryStringParameters || {};
    if (!query.code || !query.state || !oauthState || !shared.safeEqual(query.state, oauthState.state)) return textResponse(400, 'Slack authorization could not be verified. Start again from Console.');
    const tokenResponse = await fetch('https://slack.com/api/oauth.v2.access', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: configured.clientId, client_secret: configured.clientSecret, code: query.code, redirect_uri: configured.redirectUri }).toString() });
    const token = await tokenResponse.json().catch(() => null);
    if (!tokenResponse.ok || !token || !token.ok || !token.access_token) return response(400, page('Slack authorization failed', '<h1>Authorization failed</h1><p class="warning">Slack did not return a usable bot token. Confirm the OAuth redirect URL and reinstall the Slack app after saving its bot scopes.</p>'), { 'Content-Type': 'text/html; charset=utf-8', 'Set-Cookie': shared.clearCookie(STATE_COOKIE) });
    const available = await shared.channelsForToken(token.access_token);
    if (!available.ok) return response(400, page('Slack channels unavailable', '<h1>Slack channels could not be listed</h1><p class="warning">Confirm that the Slack app was installed with <code>channels:read</code> and <code>channels:history</code> bot scopes, then try again.</p>'), { 'Content-Type': 'text/html; charset=utf-8', 'Set-Cookie': shared.clearCookie(STATE_COOKIE) });
    const tokenCookie = shared.seal({ accessToken: token.access_token, teamId: token.team && token.team.id || null, teamName: token.team && token.team.name || null, expiresAt: Date.now() + shared.COOKIE_SECONDS * 1000 }, configured.privateGatePassword);
    const options = available.channels.map((channel) => `<option value="${escapeHtml(channel.id)}">#${escapeHtml(channel.name || channel.id)}${channel.is_member ? '' : ' — add the app before indexing messages'}</option>`).join('');
    return response(200, page('Choose Slack channels', `<h1>Choose Slack channels</h1><p>Choose up to five public channels. Console indexes message activity and timestamps; it does not store message text, post messages, or access DMs/private channels.</p><p>Add the PostOpz Console Slack app to each selected channel so Slack can provide its history and real-time events.</p><form method="post" action="/console/slack/select-channels"><input type="hidden" name="request_token" value="${escapeHtml(shared.requestToken(tokenCookie, configured.privateGatePassword))}"><label>Public channels <select name="channel_ids" multiple required>${options}</select></label><button type="submit">Connect selected channels</button></form>`), { 'Content-Type': 'text/html; charset=utf-8', 'Set-Cookie': shared.cookie(TOKEN_COOKIE, tokenCookie) });
  }

  if (mode === 'select' && event.httpMethod === 'POST') {
    const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : (event.body || '');
    const params = new URLSearchParams(raw);
    const tokenCookie = cookies[TOKEN_COOKIE];
    const token = tokenCookie && shared.unseal(tokenCookie, configured.privateGatePassword);
    if (!token || !token.accessToken || token.expiresAt < Date.now() || !shared.safeEqual(params.get('request_token') || '', shared.requestToken(tokenCookie, configured.privateGatePassword))) return textResponse(400, 'The Slack authorization has expired. Start again from Console.');
    const channelIds = [...new Set(params.getAll('channel_ids').filter((id) => /^[CG][A-Z0-9]{6,20}$/.test(id)))].slice(0, 5);
    if (!channelIds.length) return textResponse(400, 'Choose at least one public Slack channel.');
    const available = await shared.channelsForToken(token.accessToken);
    const selected = available.channels.filter((channel) => channelIds.includes(channel.id));
    if (!selected.length) return textResponse(400, 'The selected Slack channels are no longer available. Start again.');
    const record = await shared.authorizedConnection(configured, user);
    if (!record) return textResponse(403, 'This Console account cannot configure the Slack connection.');
    const updatedConfiguration = { ...(record.configuration || {}), team_id: token.teamId, team_name: token.teamName, selected_channel_ids: selected.map((channel) => channel.id), selected_channel_names: selected.map((channel) => channel.name || channel.id), access_mode: 'public_channel_metadata_and_activity_readonly' };
    await shared.supabase(configured, `/rest/v1/integration_connections?id=eq.${encodeURIComponent(record.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'pending', configuration: updatedConfiguration }) });
    const refreshed = { ...record, configuration: updatedConfiguration };
    let index = null; try { index = await shared.indexSlackActivity(configured, refreshed, token.accessToken, selected, user.id); } catch (_) { /* The connection can be completed after Slack token setup even if its first snapshot is unavailable. */ }
    const content = `<h1>Slack channels connected</h1><p>${index ? `${index.observedMessageCount} recent message activities were observed; ${index.newlyIndexedCount} new activity records were added.` : 'The initial snapshot could not be completed yet. Confirm the app belongs to each selected channel, then reconnect after saving the token.'}</p><p>Copy this one-time bot token into Netlify as <code>POSTOPZ_SLACK_BOT_TOKEN</code>. It is not stored in Supabase or Console.</p><p class="warning"><b>Copy now:</b><br><code>${escapeHtml(token.accessToken)}</code><br><br>Mark it as a secret and scope it to Functions. Then configure the Slack signing secret and Events API as described in <code>SLACK_SETUP.md</code>.</p><p><a href="/console?view=integrations">Return to Console</a></p>`;
    return response(200, page('Slack connected', content), { 'Content-Type': 'text/html; charset=utf-8', 'Set-Cookie': `${shared.clearCookie(TOKEN_COOKIE)}, ${shared.clearCookie(STATE_COOKIE)}` });
  }
  return textResponse(404, 'Not found.');
};
