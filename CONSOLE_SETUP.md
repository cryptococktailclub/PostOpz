# PostOpz Console — alpha setup

## What is included now

The `/console` route is served by a Netlify Function rather than a public static file. It has HTTP Basic Authentication, no-cache headers, clickjacking protection, a restrictive content-security policy, `X-Robots-Tag: noindex, nofollow, noarchive`, and a matching `robots.txt` exclusion.

The route fails closed: without a Netlify environment variable it returns HTTP 503 and does not expose the Console interface.

This is a temporary private-access layer while Supabase Auth and role-based authorization are provisioned. It does not provide per-user access, audit records, integrations, or data storage.

## Netlify configuration

In the Netlify site configuration, add the environment variable below for the production deployment and any preview deployment that should expose Console:

| Variable | Value |
| --- | --- |
| `POSTOPZ_CONSOLE_ALPHA_PASSWORD` | A unique, high-entropy password stored only in Netlify's secret environment-variable manager. |

After deployment, browse to `https://postopz.com/console` and sign in with:

- Username: `operator`
- Password: the value of `POSTOPZ_CONSOLE_ALPHA_PASSWORD`

Use a password manager to distribute this credential. Rotate it immediately if a recipient should lose access. Do not commit it to GitHub or add it to a browser-side JavaScript file.

## Required before data/integrations

1. Create a Supabase project, then configure PostOpz Console redirect URLs and secrets in Netlify.
2. Replace this shared Basic Auth gate with Supabase Auth plus organization-scoped RLS and role permissions.
3. Create provider OAuth apps/API credentials with least-privilege, read-only access; begin with non-production/test data.
4. Add webhook verification, idempotent ingestion, encrypted credential references, audit logs, and a durable job queue before enabling any migration workflow.

## Migration policy for alpha

Source-media deletion must remain unavailable. The only permitted future job sequence is:

`copy → verify → register → hold`

The codebase must not add a delete endpoint, cleanup worker, lifecycle policy, or automatic source-removal path until a later, explicitly approved release.
