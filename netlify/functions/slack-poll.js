const shared = require('./slack-shared');

exports.handler = async () => {
  const configured = shared.config();
  if (!configured || !configured.connectionId || !configured.botToken) return { statusCode: 204, body: '' };
  const record = await shared.connection(configured);
  if (!record) return { statusCode: 204, body: '' };
  const ids = record.configuration && record.configuration.selected_channel_ids || [];
  const names = record.configuration && record.configuration.selected_channel_names || [];
  if (!ids.length) return { statusCode: 204, body: '' };
  const channels = ids.slice(0, 5).map((id, index) => ({ id, name: names[index] || id }));
  try {
    await shared.indexSlackActivity(configured, record, configured.botToken, channels);
    return { statusCode: 204, body: '' };
  } catch (_) {
    await shared.supabase(configured, `/rest/v1/integration_connections?id=eq.${encodeURIComponent(record.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'degraded', last_error_at: new Date().toISOString(), last_error_summary: 'Slack fallback polling could not complete.' }) });
    return { statusCode: 500, body: '' };
  }
};
