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

`SUPABASE_URL` and `SUPABASE_SECRET_KEY` must already be present in the same Functions context. The webhook uses the Supabase secret key only inside the Netlify Function to write verified events.

## Create the Frame.io webhook

1. In Adobe Developer Console, create or open a project with the Frame.io V4 API and an OAuth Web App credential. Use a least-privilege user/service account that has access only to the intended Frame.io workspace.
2. Use Frame.io’s V4 API to create a webhook for the intended account and workspace, with the URL:

   ```text
   https://YOUR-NETLIFY-DEPLOY-URL/console/webhooks/frameio
   ```

   Use the current Netlify Deploy Preview URL for an alpha test. Use `https://postopz.com/console/webhooks/frameio` only after the production Console release and production environment variables are ready.

3. Start with a small event list, such as file creation, comments, approval, and proxy/transcode completion. The Frame.io webhook creation response returns the signing secret **once**; copy it directly into `POSTOPZ_FRAMEIO_WEBHOOK_SECRET` in Netlify. Do not commit it, put it in Supabase, or share it in chat.
4. Trigger a noncritical test event in Frame.io and confirm it appears in the Console activity feed.

Frame.io documents its V4 webhook endpoints, required OAuth tokens, signing procedure, retries, and event catalog in its [webhook guide](https://developer.adobe.com/frameio/guides/Webhooks/).

## Safety boundaries

- Invalid, stale, unsigned, or duplicate deliveries are rejected or ignored.
- The webhook has no source-media deletion or storage-migration capability.
- OAuth access is used only to create/manage the Frame.io webhook; Console’s receiver acts only on valid incoming events.
- If a webhook secret is exposed, rotate it by creating a replacement webhook, update the Netlify secret, then remove the compromised webhook.
