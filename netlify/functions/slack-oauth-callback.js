const { handler } = require('./slack-oauth');
// Preserve Slack's OAuth code and state query parameters.
exports.handler = (event, context) => handler({ ...event, queryStringParameters: { ...(event.queryStringParameters || {}), mode: 'callback' } }, context);
