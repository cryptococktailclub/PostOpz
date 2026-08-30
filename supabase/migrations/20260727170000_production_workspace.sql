-- PostOpz Console production workspace
-- This creates private context links only. It does not change, copy, or delete
-- content in Slack, Google Drive, Frame.io, or any media-storage provider.

create table public.production_source_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  production_id uuid not null references public.productions(id) on delete cascade,
  integration_connection_id uuid references public.integration_connections(id) on delete set null,
  provider public.integration_provider not null,
  external_id text not null check (char_length(external_id) between 1 and 240),
  label text not null check (char_length(label) between 1 and 240),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (production_id, provider, external_id)
);

create index production_source_links_production_idx
on public.production_source_links (production_id, created_at desc);

create or replace function public.validate_production_source_link()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  production_organization_id uuid;
  connection_organization_id uuid;
begin
  select organization_id into production_organization_id
  from public.productions where id = new.production_id;
  if production_organization_id is null or production_organization_id <> new.organization_id then
    raise exception 'production_source_links organization must match its production';
  end if;
  if new.integration_connection_id is not null then
    select organization_id into connection_organization_id
    from public.integration_connections where id = new.integration_connection_id;
    if connection_organization_id is null or connection_organization_id <> new.organization_id then
      raise exception 'production_source_links connection must belong to the same organization';
    end if;
  end if;
  return new;
end;
$$;

create trigger production_source_links_validate
before insert or update on public.production_source_links
for each row execute procedure public.validate_production_source_link();

alter table public.production_source_links enable row level security;

create policy production_source_links_read on public.production_source_links
for select to authenticated
using (public.is_organization_member(organization_id));

create policy production_source_links_write on public.production_source_links
for insert to authenticated
with check (public.has_organization_role(organization_id, array['operator', 'admin']::public.console_role[]));

create policy production_source_links_delete on public.production_source_links
for delete to authenticated
using (public.has_organization_role(organization_id, array['operator', 'admin']::public.console_role[]));

-- Alpha safety guard: source links are metadata assignments. Removing one only
-- detaches the Console context; it cannot remove or modify provider content.
