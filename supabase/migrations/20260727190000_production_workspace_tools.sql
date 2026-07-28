-- PostOpz Console production workspace tools
-- Adds Editor support and project-scoped connection metadata. Team approval
-- workflows intentionally do not live in a production workspace.

create or replace function public.is_production_editor(target_production_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.production_members
    where production_id = target_production_id
      and user_id = auth.uid()
      and role = 'editor'
  );
$$;

-- Production members need the safe connection metadata (such as the mapped
-- channel label) to use their workspace, but only where a source link assigns
-- that connection to one of their productions. Tokens remain in Netlify and
-- are never stored in this table.
drop policy if exists integrations_read on public.integration_connections;
create policy integrations_read on public.integration_connections for select to authenticated
using (
  public.has_global_console_access(organization_id)
  or exists (
    select 1 from public.production_source_links link
    join public.production_members membership on membership.production_id = link.production_id
    where link.integration_connection_id = integration_connections.id
      and membership.user_id = auth.uid()
  )
);

revoke all on function public.is_production_editor(uuid) from public;
grant execute on function public.is_production_editor(uuid) to authenticated;

-- Safety: source-media deletion and provider-side actions remain disabled.
