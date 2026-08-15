-- Lets Console Operators discard an unused integration setup draft.
-- This is intentionally limited to records that have never synchronized.
-- It cannot remove media, provider content, activity, or a connected source.

create policy integrations_discard_unused_pending on public.integration_connections
for delete to authenticated
using (
  status = 'pending'
  and last_synced_at is null
  and public.has_organization_role(
    organization_id,
    array['operator', 'admin']::public.console_role[]
  )
);
