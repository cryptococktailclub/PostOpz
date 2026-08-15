-- PostOpz Console production-member permissions
-- A production member can access only the production explicitly assigned to
-- them. Console Operators/Admins retain full organization-wide access.

create table public.production_members (
  production_id uuid not null references public.productions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'viewer' check (role in ('viewer', 'editor')),
  granted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (production_id, user_id)
);

create table public.production_access_invites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  production_id uuid not null references public.productions(id) on delete cascade,
  email text not null check (email = lower(email) and char_length(email) between 3 and 320),
  role text not null default 'viewer' check (role in ('viewer', 'editor')),
  invited_by uuid references auth.users(id) on delete set null,
  accepted_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (production_id, email)
);

create index production_members_user_idx on public.production_members (user_id, production_id);
create index production_access_invites_email_idx on public.production_access_invites (email) where accepted_at is null;

create or replace function public.is_production_member(target_production_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.production_members
    where production_id = target_production_id and user_id = auth.uid()
  );
$$;

create or replace function public.has_global_console_access(target_organization_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_organization_role(
    target_organization_id,
    array['operator', 'approver', 'admin']::public.console_role[]
  );
$$;

create or replace function public.has_production_access_in_organization(target_organization_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.production_members membership
    join public.productions production on production.id = membership.production_id
    where membership.user_id = auth.uid() and production.organization_id = target_organization_id
  );
$$;

create or replace function public.can_read_production_source_event(target_organization_id uuid, target_event_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_global_console_access(target_organization_id) or exists (
    select 1
    from public.source_events event
    join public.production_source_links link
      on link.organization_id = event.organization_id
      and link.provider = event.provider
      and link.external_id = coalesce(event.payload ->> 'channel_id', '')
    join public.production_members membership on membership.production_id = link.production_id
    where event.id = target_event_id and membership.user_id = auth.uid()
  );
$$;

create or replace function public.can_read_activity_item(target_organization_id uuid, target_production_id uuid, target_source_event_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_global_console_access(target_organization_id)
    or (target_production_id is not null and public.is_production_member(target_production_id))
    or (target_source_event_id is not null and public.can_read_production_source_event(target_organization_id, target_source_event_id));
$$;

create or replace function public.validate_production_access_invite()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  production_organization_id uuid;
begin
  new.email := lower(trim(new.email));
  select organization_id into production_organization_id from public.productions where id = new.production_id;
  if production_organization_id is null or production_organization_id <> new.organization_id then
    raise exception 'production access invite must match the production organization';
  end if;
  return new;
end;
$$;

create trigger production_access_invites_validate
before insert or update on public.production_access_invites
for each row execute procedure public.validate_production_access_invite();

alter table public.production_members enable row level security;
alter table public.production_access_invites enable row level security;

create policy production_members_read on public.production_members
for select to authenticated
using (
  public.is_production_member(production_id)
  or exists (
    select 1 from public.productions production
    where production.id = production_members.production_id
      and public.has_global_console_access(production.organization_id)
  )
);

create policy production_members_manage on public.production_members
for all to authenticated
using (
  exists (
    select 1 from public.productions production
    where production.id = production_members.production_id
      and public.has_organization_role(production.organization_id, array['operator', 'admin']::public.console_role[])
  )
)
with check (
  exists (
    select 1 from public.productions production
    where production.id = production_members.production_id
      and public.has_organization_role(production.organization_id, array['operator', 'admin']::public.console_role[])
  )
);

create policy production_access_invites_read on public.production_access_invites
for select to authenticated
using (public.has_global_console_access(organization_id));

create policy production_access_invites_manage on public.production_access_invites
for all to authenticated
using (public.has_organization_role(organization_id, array['operator', 'admin']::public.console_role[]))
with check (public.has_organization_role(organization_id, array['operator', 'admin']::public.console_role[]));

drop policy if exists organization_read on public.organizations;
create policy organization_read on public.organizations for select to authenticated
using (public.is_organization_member(id) or public.has_production_access_in_organization(id));

drop policy if exists productions_read on public.productions;
create policy productions_read on public.productions for select to authenticated
using (public.has_global_console_access(organization_id) or public.is_production_member(id));

drop policy if exists events_read on public.source_events;
create policy events_read on public.source_events for select to authenticated
using (public.can_read_production_source_event(organization_id, id));

drop policy if exists activity_read on public.activity_items;
create policy activity_read on public.activity_items for select to authenticated
using (public.can_read_activity_item(organization_id, production_id, source_event_id));

drop policy if exists workspace_files_read on public.workspace_files;
create policy workspace_files_read on public.workspace_files for select to authenticated
using (public.has_global_console_access(organization_id) or (production_id is not null and public.is_production_member(production_id)));

drop policy if exists production_source_links_read on public.production_source_links;
create policy production_source_links_read on public.production_source_links
for select to authenticated
using (public.has_global_console_access(organization_id) or public.is_production_member(production_id));

revoke all on function public.is_production_member(uuid) from public;
revoke all on function public.has_global_console_access(uuid) from public;
revoke all on function public.has_production_access_in_organization(uuid) from public;
revoke all on function public.can_read_production_source_event(uuid, uuid) from public;
revoke all on function public.can_read_activity_item(uuid, uuid, uuid) from public;
grant execute on function public.is_production_member(uuid) to authenticated;
grant execute on function public.has_global_console_access(uuid) to authenticated;
grant execute on function public.has_production_access_in_organization(uuid) to authenticated;
grant execute on function public.can_read_production_source_event(uuid, uuid) to authenticated;
grant execute on function public.can_read_activity_item(uuid, uuid, uuid) to authenticated;

-- Safety: this migration only controls access to Console metadata. It cannot
-- modify Slack, provider files, storage objects, or source media.
