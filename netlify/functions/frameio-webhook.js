const crypto = require('crypto');

const MAX_SIGNATURE_AGE_SECONDS = 300;
const responseHeaders = {
  'Cache-Control': 'no-store, max-age=0',
  'Content-Type': 'text/plain; charset=utf-8',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-Robots-Tag': 'noindex, nofollow, noarchive'
};

function response(statusCode, body) {
  return { statusCode, headers: responseHeaders, body };
}

function header(event, name) {
  const headers = event.headers || {};
  return headers[name] || headers[name.toLowerCase()] || headers[name.toUpperCase()] || '';
}

function rawBody(event) {
  return event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : (event.body || '');
}

function safeEqual(actual, expected) {
  const received = Buffer.from(actual, 'utf8');
  const required = Buffer.from(expected, 'utf8');
  return received.length === required.length && crypto.timingSafeEqual(received, required);
}

function validSignature(timestamp, signature, body, secret) {
  const sentAt = Number(timestamp);
  if (!Number.isInteger(sentAt) || Math.abs(Math.floor(Date.now() / 1000) - sentAt) > MAX_SIGNATURE_AGE_SECONDS) return false;
  const expected = `v0=${crypto.createHmac('sha256', secret).update(`v0:${timestamp}:${body}`, 'utf8').digest('hex')}`;
  return safeEqual(signature, expected);
}

function serviceConfig() {
  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  const connectionId = process.env.POSTOPZ_FRAMEIO_CONNECTION_ID;
  const webhookSecret = process.env.POSTOPZ_FRAMEIO_WEBHOOK_SECRET;
  if (!url || !secretKey || !connectionId || !webhookSecret) return null;
  return { url: url.replace(/\/$/, ''), secretKey, connectionId, webhookSecret };
}

async function databaseRequest(config, path, options = {}) {
  const result = await fetch(`${config.url}${path}`, {
    method: options.method || 'GET',
    headers: {
      apikey: config.secretKey,
      Authorization: `Bearer ${config.secretKey}`,
      ...(options.headers || {})
    },
    body: options.body
  });
  const text = await result.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch (_) { data = null; }
  }
  return { ok: result.ok, status: result.status, data };
}

function firstText(...values) {
  return values.find((value) => typeof value === 'string' && value.trim()) || null;
}

function normalizedEvent(payload, raw) {
  const eventType = firstText(payload.event_type, payload.event, payload.type, payload.name) || 'unknown';
  const resource = payload.resource || payload.data || {};
  const resourceId = firstText(resource.id, payload.resource_id, payload.file_id, payload.comment_id, payload.project_id);
  const resourceName = firstText(resource.name, resource.title, payload.resource_name, payload.file_name, payload.project_name);
  const projectId = firstText(payload.project_id, resource.project_id, resource.projectId);
  const digest = crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
  const providerEventId = firstText(payload.event_id, payload.id, payload.delivery_id) || digest;
  const lowered = eventType.toLowerCase();
  let kind = 'asset_created';
  let title = `Frame.io event: ${eventType}`;
  if (lowered.includes('comment')) { kind = 'review_commented'; title = 'Frame.io comment added'; }
  else if (lowered.includes('approv')) { kind = 'review_approved'; title = 'Frame.io review approved'; }
  else if (lowered.includes('transcod') || lowered.includes('proxy')) { kind = 'proxy_ready'; title = 'Frame.io proxy ready'; }
  else if (lowered.includes('file')) { title = 'Frame.io file created'; }
  else if (lowered.includes('project')) { title = 'Frame.io project updated'; }
  return {
    providerEventId: `frameio:${providerEventId}`,
    payloadSha256: digest,
    kind,
    title,
    detail: resourceName || resourceId || eventType,
    payload: { event_type: eventType, resource_id: resourceId, resource_name: resourceName, project_id: projectId }
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return response(405, 'Method not allowed.');
  const config = serviceConfig();
  if (!config) return response(503, 'Frame.io webhook is not configured.');

  const body = rawBody(event);
  const timestamp = header(event, 'X-Frameio-Request-Timestamp');
  const signature = header(event, 'X-Frameio-Signature');
  if (!validSignature(timestamp, signature, body, config.webhookSecret)) return response(401, 'Invalid webhook signature.');

  let payload;
  try { payload = JSON.parse(body); } catch (_) { return response(400, 'Webhook body must be JSON.'); }

  try {
    const connection = await databaseRequest(config, `/rest/v1/integration_connections?id=eq.${encodeURIComponent(config.connectionId)}&provider=eq.frame_io&select=id,organization_id`);
    if (!connection.ok || !Array.isArray(connection.data) || connection.data.length !== 1) return response(404, 'Connection not found.');

    const eventData = normalizedEvent(payload, body);
    const sourceEventId = crypto.randomUUID();
    const sourceEvent = await databaseRequest(config, '/rest/v1/source_events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({
        id: sourceEventId,
        organization_id: connection.data[0].organization_id,
        integration_connection_id: connection.data[0].id,
        provider: 'frame_io',
        provider_event_id: eventData.providerEventId,
        occurred_at: new Date(Number(timestamp) * 1000).toISOString(),
        payload: eventData.payload,
        payload_sha256: eventData.payloadSha256
      })
    });
    if (sourceEvent.status === 409) return response(200, 'Duplicate delivery ignored.');
    if (!sourceEvent.ok) return response(500, 'Could not record source event.');

    const activity = await databaseRequest(config, '/rest/v1/activity_items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({
        organization_id: connection.data[0].organization_id,
        source_event_id: sourceEventId,
        kind: eventData.kind,
        title: eventData.title,
        detail: eventData.detail,
        severity: 'info',
        occurred_at: new Date(Number(timestamp) * 1000).toISOString()
      })
    });
    if (!activity.ok) return response(500, 'Could not record activity.');

    await Promise.all([
      databaseRequest(config, `/rest/v1/integration_connections?id=eq.${encodeURIComponent(config.connectionId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ status: 'healthy', last_synced_at: new Date().toISOString(), last_error_at: null, last_error_summary: null })
      }),
      databaseRequest(config, '/rest/v1/audit_log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ organization_id: connection.data[0].organization_id, action: 'frameio.webhook.accepted', entity_type: 'source_event', entity_id: sourceEventId, metadata: { event_type: eventData.payload.event_type } })
      })
    ]);
    return response(202, 'Webhook accepted.');
  } catch (_) {
    return response(500, 'Webhook processing failed.');
  }
};
