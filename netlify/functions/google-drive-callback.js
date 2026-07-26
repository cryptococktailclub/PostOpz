const { handler } = require('./google-drive-oauth');

// Keep Google's code and state query parameters intact. Netlify replaces source
// query strings when a redirect destination itself contains query parameters.
exports.handler = (event, context) => handler({ ...event, queryStringParameters: { ...(event.queryStringParameters || {}), mode: 'callback' } }, context);
