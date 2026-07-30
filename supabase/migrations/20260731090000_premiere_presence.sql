-- PostOpz Premiere Presence alpha
-- Workstation heartbeats are deliberately limited to current project/activity
-- metadata. No media, project contents, paths, or Adobe credentials are stored.

create table public.premiere_presence_agents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  production_id uuid not null references public.productions(id) on delete cascade,
  label text not null check (char_length(label) between 2 and 120),
  token_digest text not null unique check (char_length(token_digest) = 64),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz
);

create table public.premiere_presence (
  agent_id uuid primary key references public.premiere_presence_agents(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  production_id uuid not null references public.productions(id) on delete cascade,
  editor_name text not null check (char_length(editor_name) between 1 and 120),
  project_name text,
  sequence_name text,
  premiere_version text,
  status text not null default 'active' check (status in ('active', 'idle')),
  last_heartbeat_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index premiere_presence_agents_production_idx on public.premiere_presence_agents (production_id, last_seen_at desc);
create index premiere_presence_production_idx on public.premiere_presence (production_id, last_heartbeat_at desc);

create or replace function public.validate_premiere_presence_agent()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  production_organization_id uuid;
begin
  select organization_id into production_organization_id from public.productions where id = new.production_id;
  if production_organization_id is null or production_organization_id <> new.organization_id then
    raise exception 'Premiere Presence agent must match its production organization';
  end if;
  return new;
end;
$$;

create or replace function public.validate_premiere_presence()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  agent_record public.premiere_presence_agents;
begin
  select * into agent_record from public.premiere_presence_agents where id = new.agent_id;
  if agent_record.id is null
     or agent_record.organization_id <> new.organization_id
     or agent_record.production_id <> new.production_id then
    raise exception 'Premiere Presence heartbeat must match its paired workstation';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger premiere_presence_agents_validate
before insert or update on public.premiere_presence_agents
for each row execute procedure public.validate_premiere_presence_agent();

create trigger premiere_presence_validate
before insert or update on public.premiere_presence
for each row execute procedure public.validate_premiere_presence();

alter table public.premiere_presence_agents enable row level security;
alter table public.premiere_presence enable row level security;

create policy premiere_presence_agents_read on public.premiere_presence_agents
for select to authenticated
using (public.has_global_console_access(organization_id));

create policy premiere_presence_agents_manage on public.premiere_presence_agents
for all to authenticated
using (public.has_organization_role(organization_id, array['operator', 'admin']::public.console_role[]))
with check (public.has_organization_role(organization_id, array['operator', 'admin']::public.console_role[]));

create policy premiere_presence_read on public.premiere_presence
for select to authenticated
using (public.has_global_console_access(organization_id) or public.is_production_member(production_id));

revoke all on function public.validate_premiere_presence_agent() from public;
revoke all on function public.validate_premiere_presence() from public;

-- There is intentionally no authenticated-client write policy for heartbeat
-- tables. Netlify validates each paired device token before using the service
-- key to write a presence update.
