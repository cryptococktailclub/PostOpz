-- PostOpz Console production workspace tools
-- Adds approval requests. This does not modify provider content, source media,
-- or storage objects.

create table public.production_approval_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  production_id uuid not null references public.productions(id) on delete cascade,
  title text not null check (char_length(title) between 3 and 160),
  detail text check (detail is null or char_length(detail) <= 2000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'changes_requested')),
  requested_by uuid references auth.users(id) on delete set null,
  reviewed_by uuid references auth.users(id) on delete set null,
  review_note text check (review_note is null or char_length(review_note) <= 1200),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create index production_approval_requests_production_created_idx
  on public.production_approval_requests (production_id, created_at desc);

create or replace function public.validate_production_approval_request()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  production_organization_id uuid;
begin
  select organization_id into production_organization_id from public.productions where id = new.production_id;
  if production_organization_id is null or production_organization_id <> new.organization_id then
    raise exception 'approval request must match the production organization';
  end if;
  if new.status <> 'pending' and new.reviewed_at is null then
    raise exception 'approval decisions require a review time';
  end if;
  return new;
end;
$$;

create trigger production_approval_requests_validate
before insert or update on public.production_approval_requests
for each row execute procedure public.validate_production_approval_request();

create or replace function public.is_production_editor(target_production_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.production_members
    where production_id = target_production_id
      and user_id = auth.uid()
      and role = 'editor'
  );
$$;

alter table public.production_approval_requests enable row level security;

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

create policy production_approval_requests_read on public.production_approval_requests
for select to authenticated
using (public.has_global_console_access(organization_id) or public.is_production_member(production_id));

create policy production_approval_requests_create on public.production_approval_requests
for insert to authenticated
with check (
  requested_by = auth.uid()
  and (public.has_global_console_access(organization_id) or public.is_production_editor(production_id))
);

create policy production_approval_requests_review on public.production_approval_requests
for update to authenticated
using (public.has_global_console_access(organization_id))
with check (public.has_global_console_access(organization_id) and reviewed_by = auth.uid());

revoke all on function public.is_production_editor(uuid) from public;
grant execute on function public.is_production_editor(uuid) to authenticated;

-- Safety: source-media deletion and provider-side actions remain disabled.
