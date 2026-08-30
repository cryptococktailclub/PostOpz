const { handler } = require('./google-drive-oauth');

exports.handler = (event, context) => handler({ ...event, queryStringParameters: { ...(event.queryStringParameters || {}), mode: 'download' } }, context);
