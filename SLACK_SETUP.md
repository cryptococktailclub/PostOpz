# Slack — Console alpha setup

This connector observes activity from up to five **public channels** that you select. Console Operators and Admins can also post a message or thread reply from the Console. To make the Console timeline useful, it retains the text of messages from those selected channels as activity excerpts, visible only to members of the matching PostOpz workspace. It does not edit or delete Slack messages, invite or join channels, access direct messages, or access private channels.

## 1. Apply the database migration

In Supabase, open **SQL Editor**, create a new query, paste the full contents of:

`supabase/migrations/20260727023000_slack_activity.sql`

Then click **Run**. This only adds the normalized `message_received` activity type.

## 2. Register the pending Slack connection in Console

1. Go to Console → **Integrations**.
2. Select your workspace, choose **Slack**, give it a name such as `PostOpz Slack`, then choose **Register connection**.
3. In the new Slack source row, copy its connection ID from Supabase: **Table Editor → integration_connections → Slack row → id**.

## 3. Create the Slack app

1. Go to [Slack API — Your Apps](https://api.slack.com/apps) and choose **Create New App → From scratch**.
2. Name it `PostOpz Console Alpha` and select the Slack workspace you want Console to observe.
3. Open **OAuth & Permissions**.
4. Under **Redirect URLs**, add:

   `https://deploy-preview-2--postopz.netlify.app/console/slack/callback`

5. Under **Bot Token Scopes**, add only:

   - `channels:read`
   - `channels:history`
   - `chat:write`
   - `users:read` (displays Slack member names instead of internal IDs)

6. Save changes. Do not add file-write, channel-management, DM, or private-channel scopes.
7. Open **Basic Information** and copy the **Client ID**, **Client Secret**, and **Signing Secret**. Treat the last two as secrets.

## 4. Add Netlify environment variables

In Netlify → **Site configuration → Environment variables**, add these with **Functions** scope and **Deploy Previews** value. Mark the entries labelled “secret” as **Contains secret values**.

| Variable | Value | Secret? |
| --- | --- | --- |
| `POSTOPZ_SLACK_CLIENT_ID` | Slack app Client ID | No |
| `POSTOPZ_SLACK_CLIENT_SECRET` | Slack app Client Secret | Yes |
| `POSTOPZ_SLACK_REDIRECT_URI` | `https://deploy-preview-2--postopz.netlify.app/console/slack/callback` | No |
| `POSTOPZ_SLACK_CONNECTION_ID` | The Slack row UUID from `integration_connections` | No |
| `POSTOPZ_SLACK_SIGNING_SECRET` | Slack app Signing Secret | Yes |
| `POSTOPZ_SLACK_BOT_TOKEN` | Bot User OAuth Token from Slack → **Install App** | Yes |

After saving these values, trigger a fresh Deploy Preview so the Functions receive them.

## 5. Install and connect the app

1. In Slack’s **OAuth & Permissions** page, choose **Install to Workspace** (or **Reinstall to Workspace** after adding scopes).
2. In Console → **Integrations**, choose **Connect Slack**.
3. Approve the Slack screen and select up to five public channels.
4. In Slack, add the newly installed app to each chosen channel. Console will not add itself. This is also what constrains where Console can post.
5. Console returns directly to the Slack workspace view. It never displays a provider token in the browser.

## 6. Enable signed real-time events

1. In Slack app settings, open **Socket Mode** and turn it **off**. Console receives HTTPS events through Netlify; it does not run a persistent Slack socket connection.
2. Open **Event Subscriptions** and turn on **Enable Events**.
3. Set **Request URL** to:

   `https://deploy-preview-2--postopz.netlify.app/console/webhooks/slack`

4. Wait for Slack to verify the URL. The function checks each request with the Signing Secret before accepting it.
5. Under **Subscribe to bot events**, add `message.channels`.
6. Save changes and **Reinstall to Workspace** if Slack prompts you.
7. Post a non-sensitive test message in a selected channel. It should appear in the Console timeline with its author, channel, and message excerpt.

If the request URL does not show **Verified**, check that `POSTOPZ_SLACK_SIGNING_SECRET` in Netlify is marked secret, scoped to **Functions / Deploy Previews**, and exactly matches the Signing Secret in Slack’s **Basic Information** page. During preview testing, Operators can also use **Refresh Slack activity** in Console as a manual fallback.

## Posting and automatic alerts

- On Console → **Slack**, Operators and Admins can compose messages or reply to a visible thread. Each post is limited to an approved channel and recorded in the Console audit log.
- The same page has an **Automated alerts** setting. Enable **Workspace Files** alerts and choose one approved Slack channel if you want Console to post whenever a user uploads production paperwork.
- Posting is never available to Viewer or Approver-only roles. Console does not automatically post until an Operator or Admin explicitly enables an alert rule.

## Fallback polling

`slack-poll` runs every 15 minutes **only on a published production deployment**. Netlify Scheduled Functions do not automatically run on Deploy Previews. During preview testing, **Refresh Slack activity** triggers a fresh safe snapshot.

When Console moves to production, create production-scoped Netlify values and change both Slack URLs to `https://postopz.com/console/slack/callback` and `https://postopz.com/console/webhooks/slack`, then reinstall the Slack app.
