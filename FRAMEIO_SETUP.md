# Frame.io webhook setup — private alpha

## What this enables

`/console/webhooks/frameio` receives **only Frame.io-signed** webhook deliveries. It checks the request timestamp (five-minute tolerance), verifies the Frame.io HMAC signature using a Netlify secret, deduplicates the delivery, and stores a reduced normalized event in PostOpz Console.

It does not upload, change, delete, archive, or relink Frame.io media. It also does not store Frame.io OAuth tokens or webhook secrets in Supabase.

## Prerequisites

1. Create a pending **Frame.io** connection in the Console UI.
2. In Supabase, open **Table Editor** → `integration_connections`, open that Frame.io row, and copy its `id` value.
3. Confirm that your Frame.io account supports V4 and is managed through Adobe authentication. Frame.io V4 uses OAuth access tokens created through Adobe Developer Console. See the [Frame.io authentication guide](https://developer.adobe.com/frameio/guides/Authentication/).

## Netlify variables

Add the following as **secret, Functions-scoped** Netlify variables. Use the Preview context for testing first; add Production values only when the private Console release is promoted.

| Variable | Value |
| --- | --- |
| `POSTOPZ_FRAMEIO_CONNECTION_ID` | The `integration_connections.id` value from the Frame.io pending connection row. This is an identifier, not a credential. |
| `POSTOPZ_FRAMEIO_WEBHOOK_SECRET` | The one-time signing secret returned by Frame.io when you create the webhook. |
| `POSTOPZ_FRAMEIO_CLIENT_ID` | Client ID from the Adobe Developer Console OAuth Web App credential. |
| `POSTOPZ_FRAMEIO_CLIENT_SECRET` | Client secret from that credential. Mark this as a secret. |
| `POSTOPZ_FRAMEIO_REDIRECT_URI` | Exact Console callback URL, for example `https://YOUR-NETLIFY-DEPLOY-URL/console/frameio/callback`. |
| `POSTOPZ_FRAMEIO_OAUTH_SCOPES` | Optional: scopes shown as available by the Adobe credential. Default is `openid`; use `openid,offline_access` only if Adobe lists offline access as available. |

`SUPABASE_URL` and `SUPABASE_SECRET_KEY` must already be present in the same Functions context. The webhook uses the Supabase secret key only inside the Netlify Function to write verified events.

## Connect and create the Frame.io webhook

1. In Adobe Developer Console, create or open a project, add the Frame.io V4 API, then create an **OAuth Web App** credential. Use this exact Redirect URI:

   ```text
   https://YOUR-NETLIFY-DEPLOY-URL/console/frameio/callback
   ```

   Use the current Netlify Deploy Preview URL for alpha. Use the `postopz.com` URL only after the production release is ready.
2. Add the Client ID, Client Secret, and Redirect URI to Netlify using the table above. Set all values to **Functions** scope and **Deploy Previews** context first.
3. Return to Console and select **Connect Frame.io with Adobe**. Sign in and consent through Adobe, choose the intended Frame.io workspace, then let Console create the protected webhook.
4. Console displays the signing secret once. Copy it directly to `POSTOPZ_FRAMEIO_WEBHOOK_SECRET` in Netlify. Do not commit it, put it in Supabase, or share it in chat.
5. Trigger a noncritical file upload or comment in Frame.io and confirm it appears in the Console activity feed.

Frame.io documents its V4 webhook endpoints, required OAuth tokens, signing procedure, retries, and event catalog in its [webhook guide](https://developer.adobe.com/frameio/guides/Webhooks/).

## Safety boundaries

- Invalid, stale, unsigned, or duplicate deliveries are rejected or ignored.
- The webhook has no source-media deletion or storage-migration capability.
- OAuth access is used only to create/manage the Frame.io webhook; Console’s receiver acts only on valid incoming events.
- If a webhook secret is exposed, rotate it by creating a replacement webhook, update the Netlify secret, then remove the compromised webhook.
