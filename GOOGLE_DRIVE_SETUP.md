# Google Drive / Docs metadata setup — private alpha

## What this enables

Console can perform an operator-initiated, **read-only Drive session** for the
most recently modified files accessible to the authorized Google account. It
records names, file types, modified times, optional sizes, and Drive links. In
that short session an operator can read Google Doc text or download a file (up
to 25 MB); document text and tokens are not retained by Console. It cannot
create files, edit files, move files, or delete anything.

OAuth access exists only in an encrypted short-lived browser cookie while the
operator performs the snapshot. Console does not retain a Google OAuth token
or refresh token in Supabase.

## Google Cloud configuration

1. Create or select a Google Cloud project for **PostOpz Console Alpha**.
2. Enable **Google Drive API**. The Google Docs API is optional for this
   metadata-only alpha, and may be enabled now for a later document-content
   feature.
3. Configure the OAuth consent screen as **External** and keep it in Testing
   while Console is private. Add the Google account that will be connected as
   a test user.
4. Create an OAuth 2.0 Client ID of type **Web application**. Add this exact
   authorized redirect URI:

   ```text
   https://YOUR-NETLIFY-DEPLOY-URL/console/google/callback
   ```

5. In Console, register one pending **Google Drive / Docs** connection and
   copy its `integration_connections.id` from Supabase.

## Netlify variables

Set these in **Functions** scope and the **Deploy Previews** context for the
alpha first. Mark client secret as a secret. Do not place any token in
Supabase or source control.

| Variable | Value |
| --- | --- |
| `POSTOPZ_GOOGLE_CONNECTION_ID` | The pending Google Drive connection UUID from Supabase. |
| `POSTOPZ_GOOGLE_CLIENT_ID` | OAuth Web application client ID from Google Cloud. |
| `POSTOPZ_GOOGLE_CLIENT_SECRET` | OAuth Web application client secret from Google Cloud. |
| `POSTOPZ_GOOGLE_REDIRECT_URI` | The same exact authorized redirect URI. |

`POSTOPZ_CONSOLE_ALPHA_PASSWORD`, `SUPABASE_URL`,
`SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SECRET_KEY` must already be present
in that Functions context.

## Connect and snapshot

1. Open the current private Console preview.
2. Select **Connect Google Drive / Docs**.
3. Choose the configured Google account and consent only to Google Drive and
   Google Docs **read-only** access.
4. Read a Google Doc, download a noncritical file (up to 25 MB), or select
   **Index current metadata**.
5. Return to Console and confirm the normalized activity item appears.

## Safety boundaries

- The only requested Google permissions are `drive.readonly` and
  `documents.readonly`.
- No Google OAuth or refresh token is retained after the ten-minute setup
  session.
- Document content is shown only in the active browser response and is not sent
  to an AI service or retained in Console.
- Editing, moving, creating, and deleting remain unavailable in this alpha.
- Scheduled polling and Drive change notifications are deliberately deferred
  until the token-vault and consent-refresh workflow are reviewed.
