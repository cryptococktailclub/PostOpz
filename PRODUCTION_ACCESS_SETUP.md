# Production member access

This feature gives a Console user access to only the production(s) explicitly
assigned to their email. It does not add the person to the organization-wide
Console role list.

## Apply the database migration

In Supabase **SQL Editor**, run the complete contents of:

`supabase/migrations/20260727180000_production_member_permissions.sql`

Run the earlier production-workspace migration first if it has not already
been applied:

`supabase/migrations/20260727170000_production_workspace.sql`

## Enable production workspace tools

To enable the project-scoped connection metadata and Editor capabilities, run
the complete contents of:

`supabase/migrations/20260727190000_production_workspace_tools.sql`

Roles in this alpha:

- **Viewer** — sees only the assigned production’s paperwork and mapped Slack
  activity; can download assigned paperwork.
- **Editor** — has all Viewer access plus may upload paperwork assigned to
  that production and post to its mapped Slack channel.
- **Operator/Admin** — may map channels and grant production access.

Production teams do not create formal approval requests in Console. Their
correspondence remains in their mapped Slack channel. A future client-facing
approval workflow will be reserved for PostOpz work orders and cloud-archive
migration approvals.

No role can delete source media, provider files, or workspace paperwork.

## Create the alternate sign-in

In Supabase **Authentication → Users**, create or invite the alternate email
address. Ensure it can sign in with an email and password. Do **not** add this
user to `organization_members`.

## Grant access in Console

1. Sign in with the operator account.
2. Open **Productions**, then open the intended production.
3. In **Production access**, enter the alternate email and select **Grant production access**.
4. Sign in to Console with that alternate email.

On its first sign-in, Console accepts the matching invitation and limits the
account to its assigned production. It cannot access the full Overview,
Activity, Slack, Integrations, Storage, or other production URLs.

The current alpha grants Viewer access: production members can read their
mapped activity and download only paperwork assigned to that production.
