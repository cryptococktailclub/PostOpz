const { handler } = require('./workspace-files');

exports.handler = (event, context) => handler({ ...event, queryStringParameters: { ...(event.queryStringParameters || {}), mode: 'download' } }, context);
