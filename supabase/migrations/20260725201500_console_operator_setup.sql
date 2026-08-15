-- Console operator setup
-- Apply this after 20260725193000_console_alpha.sql. It permits an operator
-- to register productions and connection intents within their own workspace.
-- It does not grant provider access, store provider credentials, or add any
-- media-deletion capability.

create policy integrations_register on public.integration_connections
for insert to authenticated
with check (
  public.has_organization_role(
    organization_id,
    array['operator', 'admin']::public.console_role[]
  )
);

create policy integrations_update on public.integration_connections
for update to authenticated
using (
  public.has_organization_role(
    organization_id,
    array['operator', 'admin']::public.console_role[]
  )
)
with check (
  public.has_organization_role(
    organization_id,
    array['operator', 'admin']::public.console_role[]
  )
);

-- Alpha safety guard: a connection is only a pending configuration record.
-- No credential material, provider write scope, transfer worker, lifecycle
-- policy, or source-deletion operation is enabled by this migration.
