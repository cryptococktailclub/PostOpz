const { handler } = require('./slack-oauth');
exports.handler = (event, context) => handler({ ...event, queryStringParameters: { ...(event.queryStringParameters || {}), mode: 'select' } }, context);
