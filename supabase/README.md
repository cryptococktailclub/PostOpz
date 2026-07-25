# Supabase setup for PostOpz Console

## Apply the alpha schema

1. In Supabase, open the PostOpz Console project.
2. Open **SQL Editor** and select **New query**.
3. Open `supabase/migrations/20260725193000_console_alpha.sql` from this repository, copy its complete contents, paste it into the query, and choose **Run**.
4. Confirm the query reports success. Do not run it a second time.

The migration creates the Console data model, organization-scoped Row Level Security policies, and audit tables. It does not add a delete capability for source media.

## Create the first Console user

1. In Supabase, open **Authentication** → **Users**.
2. Select **Add user** → **Create new user**.
3. Use the operator's email address and a unique password from a password manager. Enable automatic confirmation if Supabase presents that option.
4. Save the user, then continue with the organization bootstrap query below.

The Console sign-in page is still protected by the separate Netlify private-access gate. Do not create credentials or share API keys through source control.

## Bootstrap the PostOpz organization

After your first authenticated user exists, run the following in SQL Editor. Replace the two placeholder values before running it:

```sql
with new_organization as (
  insert into public.organizations (name, slug)
  values ('PostOpz', 'postopz')
  returning id
)
insert into public.organization_members (organization_id, user_id, role)
select new_organization.id, auth.users.id, 'admin'::public.console_role
from new_organization
join auth.users on auth.users.email = 'YOUR-CONSOLE-EMAIL@example.com';
```

Run this once only. It gives the named user administrator access to the PostOpz organization.

## Enable the Console operator setup screen

After applying the alpha schema and confirming that you can sign in at `/console`, apply `supabase/migrations/20260725201500_console_operator_setup.sql` in a **new** SQL Editor query.

This small follow-up migration lets Console administrators and operators add production records and register *pending*, read-only integration connections. It deliberately does not save any provider key, secret, token, or password in Supabase; it also does not connect to a provider or enable any migration job.

## Add editorial-platform connection types

Apply `supabase/migrations/20260725204500_console_editorial_providers.sql` after the two migrations above to add **LucidLink**, **Avid Media Composer**, **Adobe Premiere Pro**, and **DaVinci Resolve** to the pending-connection list. This is catalog-only: it does not provide a connector, API access, or access to workstations.
