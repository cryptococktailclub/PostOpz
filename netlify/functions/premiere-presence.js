const crypto = require('crypto');

const headers = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow, noarchive'
};

function reply(statusCode, body) { return { statusCode, headers, body: JSON.stringify(body) }; }
function serviceConfig() {
  const url = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  return url && secret ? { url: url.replace(/\/$/, ''), secret } : null;
}
function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
function clean(value, max = 120) { return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max); }
async function supabase(config, path, options = {}) {
  const response = await fetch(`${config.url}${path}`, {
    method: options.method || 'GET',
    headers: { apikey: config.secret, Authorization: `Bearer ${config.secret}`, ...(options.headers || {}) },
    body: options.body
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }
  return { ok: response.ok, data };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return reply(405, { error: 'method_not_allowed' });
  const config = serviceConfig();
  if (!config) return reply(503, { error: 'presence_not_configured' });
  const authorization = event.headers.authorization || event.headers.Authorization || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (token.length < 32 || token.length > 200) return reply(401, { error: 'pairing_required' });
  let payload;
  try { payload = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : event.body || '{}'); } catch (_) { return reply(400, { error: 'invalid_json' }); }
  const agentId = String(payload.agent_id || '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(agentId)) return reply(400, { error: 'invalid_agent' });
  const agentResult = await supabase(config, `/rest/v1/premiere_presence_agents?id=eq.${encodeURIComponent(agentId)}&select=id,organization_id,production_id,token_digest`);
  const agent = agentResult.ok && Array.isArray(agentResult.data) ? agentResult.data[0] : null;
  const digest = crypto.createHash('sha256').update(token, 'utf8').digest('hex');
  if (!agent || !safeEqual(digest, agent.token_digest)) return reply(401, { error: 'pairing_required' });
  const editorName = clean(payload.editor_name, 120);
  if (!editorName) return reply(400, { error: 'editor_name_required' });
  const now = new Date().toISOString();
  const status = payload.status === 'idle' ? 'idle' : 'active';
  const record = {
    agent_id: agent.id,
    organization_id: agent.organization_id,
    production_id: agent.production_id,
    editor_name: editorName,
    project_name: clean(payload.project_name, 240) || null,
    sequence_name: clean(payload.sequence_name, 240) || null,
    premiere_version: clean(payload.premiere_version, 80) || null,
    status,
    last_heartbeat_at: now
  };
  const write = await supabase(config, '/rest/v1/premiere_presence?on_conflict=agent_id', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(record)
  });
  if (!write.ok) return reply(503, { error: 'presence_write_failed' });
  await supabase(config, `/rest/v1/premiere_presence_agents?id=eq.${encodeURIComponent(agent.id)}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ last_seen_at: now })
  });
  return reply(200, { ok: true, received_at: now });
};
