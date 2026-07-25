# Supabase setup for PostOpz Console

## Apply the alpha schema

1. In Supabase, open the PostOpz Console project.
2. Open **SQL Editor** and select **New query**.
3. Open `supabase/migrations/20260725193000_console_alpha.sql` from this repository, copy its complete contents, paste it into the query, and choose **Run**.
4. Confirm the query reports success. Do not run it a second time.

The migration creates the Console data model, organization-scoped Row Level Security policies, and audit tables. It does not add a delete capability for source media.

## Create the first Console user

Do this only after the Console sign-in page has been added in a later pull request. The preferred route is an email invitation through Supabase Authentication. Do not create credentials or share API keys through source control.

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
