const crypto = require('crypto');

const SESSION_COOKIE = 'postopz_console_access';
const COOKIE_SECONDS = 600;

function header(headers, name) { return headers[name] || headers[name.toLowerCase()] || headers[name.toUpperCase()] || ''; }
function readCookies(headers) { return (header(headers, 'cookie') || '').split(';').reduce((cookies, part) => { const separator = part.indexOf('='); if (separator >= 0) cookies[part.slice(0, separator).trim()] = decodeURIComponent(part.slice(separator + 1).trim()); return cookies; }, {}); }
function safeEqual(actual, expected) { const a = Buffer.from(String(actual), 'utf8'); const b = Buffer.from(String(expected), 'utf8'); return a.length === b.length && crypto.timingSafeEqual(a, b); }
function encryptionKey(password) { return crypto.createHash('sha256').update(password, 'utf8').digest(); }
function seal(value, password) { const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(password), iv); const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url'); }
function unseal(value, password) { try { const data = Buffer.from(value, 'base64url'); const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(password), data.subarray(0, 12)); decipher.setAuthTag(data.subarray(12, 28)); return JSON.parse(Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8')); } catch (_) { return null; } }
function cookie(name, value, maxAge = COOKIE_SECONDS) { return `${name}=${encodeURIComponent(value)}; Path=/console; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`; }
function clearCookie(name) { return cookie(name, '', 0); }
function requestToken(tokenCookie, password) { return crypto.createHmac('sha256', password).update(tokenCookie, 'utf8').digest('base64url'); }
function formToken(accessToken, password) { return crypto.createHmac('sha256', password).update(accessToken, 'utf8').digest('base64url'); }

function config() {
  const privateGatePassword = process.env.POSTOPZ_CONSOLE_ALPHA_PASSWORD;
  const clientId = process.env.POSTOPZ_SLACK_CLIENT_ID;
  const clientSecret = process.env.POSTOPZ_SLACK_CLIENT_SECRET;
  const redirectUri = process.env.POSTOPZ_SLACK_REDIRECT_URI;
  const connectionId = process.env.POSTOPZ_SLACK_CONNECTION_ID;
  const signingSecret = process.env.POSTOPZ_SLACK_SIGNING_SECRET;
  const botToken = process.env.POSTOPZ_SLACK_BOT_TOKEN;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
  if (!privateGatePassword || !supabaseUrl || !supabaseKey || !supabaseSecretKey) return null;
  return { privateGatePassword, clientId, clientSecret, redirectUri, connectionId, signingSecret, botToken, supabaseUrl: supabaseUrl.replace(/\/$/, ''), supabaseKey, supabaseSecretKey };
}

async function supabase(configured, path, options = {}) {
  const response = await fetch(`${configured.supabaseUrl}${path}`, {
    method: options.method || 'GET',
    headers: {
      apikey: options.accessToken ? configured.supabaseKey : configured.supabaseSecretKey,
      Authorization: `Bearer ${options.accessToken || configured.supabaseSecretKey}`,
      ...(options.headers || {})
    },
    body: options.body
  });
  const text = await response.text(); let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }
  return { ok: response.ok, status: response.status, data };
}

async function currentUser(configured, accessToken) { const result = await supabase(configured, '/auth/v1/user', { accessToken }); return result.ok && result.data && result.data.id ? result.data : null; }
async function connection(configured) {
  if (!configured.connectionId) return null;
  const result = await supabase(configured, `/rest/v1/integration_connections?id=eq.${encodeURIComponent(configured.connectionId)}&provider=eq.slack&select=id,organization_id,configuration,status`);
  return result.ok && Array.isArray(result.data) && result.data.length === 1 ? result.data[0] : null;
}
async function authorizedConnection(configured, user) {
  const record = await connection(configured);
  if (!record) return null;
  const result = await supabase(configured, `/rest/v1/organization_members?organization_id=eq.${encodeURIComponent(record.organization_id)}&user_id=eq.${encodeURIComponent(user.id)}&select=role`);
  return result.ok && Array.isArray(result.data) && result.data.some((item) => ['operator', 'admin'].includes(item.role)) ? record : null;
}

async function slackRequest(token, method, params = {}) {
  const query = new URLSearchParams(params);
  const response = await fetch(`https://slack.com/api/${method}?${query}`, { headers: { Authorization: `Bearer ${token}` } });
  const data = await response.json().catch(() => null);
  return { ok: response.ok && !!(data && data.ok), status: response.status, data };
}

async function channelsForToken(token) {
  const channels = [];
  let cursor = '';
  for (let page = 0; page < 4; page += 1) {
    const result = await slackRequest(token, 'conversations.list', { types: 'public_channel', exclude_archived: 'true', limit: '200', cursor });
    if (!result.ok) return { ok: false, channels: [] };
    channels.push(...(Array.isArray(result.data.channels) ? result.data.channels : []).filter((channel) => channel && channel.id && !channel.is_archived));
    cursor = result.data.response_metadata && result.data.response_metadata.next_cursor || '';
    if (!cursor) break;
  }
  return { ok: true, channels };
}

function messageRows(channel, messages) {
  return (Array.isArray(messages) ? messages : [])
    .filter((message) => message && message.type === 'message' && message.ts)
    .slice(0, 20)
    .map((message) => {
      const text = String(message.text || '');
      const textExcerpt = text.replace(/\s+/g, ' ').trim();
      return { channelId: channel.id, channelName: channel.name || channel.id, ts: String(message.ts), userId: message.user || message.bot_id || null, subtype: message.subtype || null, textDigest: crypto.createHash('sha256').update(text, 'utf8').digest('hex'), hasText: Boolean(textExcerpt), textExcerpt: textExcerpt.slice(0, 4000), textTruncated: textExcerpt.length > 4000 };
    });
}

async function slackUserNames(token, userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean))].slice(0, 100);
  const entries = await Promise.all(ids.map(async (id) => {
    const result = await slackRequest(token, 'users.info', { user: id });
    const user = result.ok && result.data && result.data.user;
    const name = user && (user.profile && (user.profile.display_name || user.profile.real_name) || user.real_name || user.name);
    return [id, name || 'Slack member'];
  }));
  return new Map(entries);
}

function activityTitle(message) { return `${message.authorName || 'Slack member'} in #${message.channelName}`; }
function activityDetail(message, realTime = false) {
  if (message.textExcerpt) return message.textTruncated ? `${message.textExcerpt}…` : message.textExcerpt;
  return realTime ? 'A Slack system event was received.' : 'A Slack system event was indexed.';
}

async function indexSlackActivity(configured, record, token, channels, actorId = null) {
  const observedAt = new Date().toISOString();
  const selected = channels.slice(0, 5);
  const histories = await Promise.all(selected.map(async (channel) => ({ channel, result: await slackRequest(token, 'conversations.history', { channel: channel.id, limit: '20' }) })));
  const messages = histories.flatMap(({ channel, result }) => result.ok ? messageRows(channel, result.data.messages) : []);
  const names = await slackUserNames(token, messages.map((message) => message.userId));
  messages.forEach((message) => { message.authorName = names.get(message.userId) || 'Slack member'; });
  const resources = selected.map((channel) => ({ organization_id: record.organization_id, integration_connection_id: record.id, provider: 'slack', external_id: channel.id, resource_type: 'slack_channel', name: String(channel.name || channel.id).slice(0, 240), external_url: record.configuration && record.configuration.team_id ? `https://app.slack.com/client/${encodeURIComponent(record.configuration.team_id)}/${encodeURIComponent(channel.id)}` : null, metadata: { is_private: Boolean(channel.is_private), member_count: channel.num_members || null }, observed_at: observedAt }));
  if (resources.length) await supabase(configured, '/rest/v1/external_resources?on_conflict=organization_id,provider,external_id,resource_type', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(resources) });
  const events = messages.map((message) => ({ organization_id: record.organization_id, integration_connection_id: record.id, provider: 'slack', provider_event_id: `slack:${message.channelId}:${message.ts}`, occurred_at: new Date(Number(message.ts) * 1000).toISOString(), payload: { channel_id: message.channelId, channel_name: message.channelName, sender_id: message.userId, author_name: message.authorName, subtype: message.subtype, has_text: message.hasText, text_excerpt: message.textExcerpt, text_truncated: message.textTruncated, text_sha256: message.textDigest }, payload_sha256: message.textDigest }));
  let indexed = [];
  if (events.length) {
    const write = await supabase(configured, '/rest/v1/source_events?on_conflict=organization_id,provider,provider_event_id', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify(events) });
    if (!write.ok) throw new Error('source-event-index');
    indexed = Array.isArray(write.data) ? write.data : [];
  }
  if (indexed.length) {
    const byId = new Map(messages.map((message) => [`slack:${message.channelId}:${message.ts}`, message]));
    const activities = indexed.map((event) => {
      const message = byId.get(event.provider_event_id);
      return { organization_id: record.organization_id, source_event_id: event.id, kind: 'message_received', title: activityTitle(message), detail: activityDetail(message), severity: 'info', occurred_at: event.occurred_at };
    });
    const activity = await supabase(configured, '/rest/v1/activity_items?on_conflict=source_event_id', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(activities) });
    if (!activity.ok) throw new Error('activity-index');
  }
  await supabase(configured, `/rest/v1/integration_connections?id=eq.${encodeURIComponent(record.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'healthy', last_synced_at: observedAt, last_error_at: null, last_error_summary: null, configuration: { ...(record.configuration || {}), access_mode: 'public_channel_metadata_and_activity_readonly', selected_channel_ids: selected.map((channel) => channel.id), selected_channel_names: selected.map((channel) => channel.name || channel.id), last_snapshot_message_count: messages.length } }) });
  await supabase(configured, '/rest/v1/audit_log', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ organization_id: record.organization_id, actor_id: actorId, action: 'slack.activity.indexed', entity_type: 'integration_connection', entity_id: record.id, metadata: { selected_channel_count: selected.length, observed_message_count: messages.length, refreshed_message_count: indexed.length } }) });
  return { selectedChannelCount: selected.length, observedMessageCount: messages.length, refreshedMessageCount: indexed.length };
}

async function indexSlackEvent(configured, record, eventId, event, teamId) {
  if (!event || !event.type || !event.channel || !event.ts) return { ignored: true };
  const observedAt = new Date().toISOString();
  const channelNames = record.configuration && record.configuration.selected_channel_names || [];
  const channelIds = record.configuration && record.configuration.selected_channel_ids || [];
  if (channelIds.length && !channelIds.includes(event.channel)) return { ignored: true };
  const channelName = channelNames[channelIds.indexOf(event.channel)] || event.channel;
  const text = String(event.text || '');
  const textExcerpt = text.replace(/\s+/g, ' ').trim();
  const textDigest = crypto.createHash('sha256').update(text, 'utf8').digest('hex');
  const names = await slackUserNames(configured.botToken, [event.user || event.bot_id]);
  const message = { channelName, userId: event.user || event.bot_id || null, authorName: names.get(event.user || event.bot_id) || 'Slack member', textExcerpt: textExcerpt.slice(0, 4000), textTruncated: textExcerpt.length > 4000 };
  // Use the same durable ID as the polling snapshot so an event and a later
  // refresh update one timeline item instead of creating two.
  const providerEventId = `slack:${event.channel}:${event.ts}`;
  const source = await supabase(configured, '/rest/v1/source_events?on_conflict=organization_id,provider,provider_event_id', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify({ organization_id: record.organization_id, integration_connection_id: record.id, provider: 'slack', provider_event_id: providerEventId, occurred_at: new Date(Number(event.ts) * 1000).toISOString(), payload: { team_id: teamId || null, channel_id: event.channel, channel_name: channelName, sender_id: message.userId, author_name: message.authorName, subtype: event.subtype || null, has_text: Boolean(textExcerpt), text_excerpt: message.textExcerpt, text_truncated: message.textTruncated, text_sha256: textDigest }, payload_sha256: textDigest }) });
  if (!source.ok) throw new Error('source-event');
  const indexed = Array.isArray(source.data) && source.data[0];
  if (!indexed) throw new Error('source-event-result');
  const activity = await supabase(configured, '/rest/v1/activity_items?on_conflict=source_event_id', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ organization_id: record.organization_id, source_event_id: indexed.id, kind: 'message_received', title: activityTitle(message), detail: activityDetail(message, true), severity: 'info', occurred_at: indexed.occurred_at }) });
  if (!activity.ok) throw new Error('activity');
  await supabase(configured, `/rest/v1/integration_connections?id=eq.${encodeURIComponent(record.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'healthy', last_synced_at: observedAt, last_error_at: null, last_error_summary: null }) });
  return { indexed: true };
}

module.exports = { SESSION_COOKIE, COOKIE_SECONDS, header, readCookies, safeEqual, seal, unseal, cookie, clearCookie, requestToken, formToken, config, supabase, currentUser, connection, authorizedConnection, slackRequest, channelsForToken, indexSlackActivity, indexSlackEvent };
