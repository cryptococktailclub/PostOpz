const crypto = require('crypto');
const shared = require('./slack-shared');

const securityHeaders = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'X-Robots-Tag': 'noindex, nofollow, noarchive' };
function response(statusCode, body, headers = {}) { return { statusCode, headers: { ...securityHeaders, ...headers }, body }; }
function rawBody(event) { return event.isBase64Encoded ? Buffer.from(event.body || '', 'base64') : Buffer.from(event.body || '', 'utf8'); }
function verified(event, signingSecret, raw) {
  const timestamp = shared.header(event.headers || {}, 'x-slack-request-timestamp');
  const signature = shared.header(event.headers || {}, 'x-slack-signature');
  if (!/^[0-9]{10,13}$/.test(timestamp) || !signature.startsWith('v0=')) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 60 * 5) return false;
  const expected = `v0=${crypto.createHmac('sha256', signingSecret).update(`v0:${timestamp}:`).update(raw).digest('hex')}`;
  return shared.safeEqual(signature, expected);
}

exports.handler = async (event) => {
  const configured = shared.config();
  if (!configured || !configured.signingSecret || !configured.connectionId) return response(503, 'Slack webhook is not configured.', { 'Content-Type': 'text/plain; charset=utf-8' });
  if (event.httpMethod !== 'POST') return response(405, 'Method not allowed.', { Allow: 'POST', 'Content-Type': 'text/plain; charset=utf-8' });
  const raw = rawBody(event);
  if (!verified(event, configured.signingSecret, raw)) return response(401, 'Slack signature could not be verified.', { 'Content-Type': 'text/plain; charset=utf-8' });
  const payload = JSON.parse(raw.toString('utf8') || '{}');
  if (payload.type === 'url_verification' && typeof payload.challenge === 'string') return response(200, payload.challenge, { 'Content-Type': 'text/plain; charset=utf-8' });
  if (payload.type !== 'event_callback' || !payload.event) return response(200, '', { 'Content-Type': 'text/plain; charset=utf-8' });
  const record = await shared.connection(configured);
  if (!record || (record.configuration && record.configuration.team_id && payload.team_id && record.configuration.team_id !== payload.team_id)) return response(403, 'Slack workspace is not authorized.', { 'Content-Type': 'text/plain; charset=utf-8' });
  try {
    if (payload.event.type === 'message' && !payload.event.hidden) await shared.indexSlackEvent(configured, record, payload.event_id, payload.event, payload.team_id);
  } catch (_) {
    // Slack retries failed deliveries. A non-2xx response preserves that retry
    // behaviour without exposing internal database details to the caller.
    return response(500, 'Slack activity could not be indexed.', { 'Content-Type': 'text/plain; charset=utf-8' });
  }
  return response(200, '', { 'Content-Type': 'text/plain; charset=utf-8' });
};
