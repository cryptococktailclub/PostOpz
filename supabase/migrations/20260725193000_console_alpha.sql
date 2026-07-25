-- PostOpz Console alpha foundation
-- Apply this file once in Supabase SQL Editor. It creates metadata and
-- governance records only; it never stores provider credentials or media.

create extension if not exists pgcrypto;

create type public.console_role as enum ('viewer', 'operator', 'approver', 'admin');
create type public.integration_provider as enum (
  'iconik', 'google_drive', 'frame_io', 'masv', 'slack', 'aws_s3', 'backblaze_b2', 'wasabi'
);
create type public.integration_status as enum ('pending', 'healthy', 'degraded', 'disconnected');
create type public.activity_kind as enum (
  'media_available', 'upload_completed', 'upload_failed', 'asset_created', 'proxy_ready',
  'review_created', 'review_commented', 'review_approved', 'document_changed',
  'message_escalated', 'storage_capacity_risk', 'cost_forecast_changed',
  'archive_candidate_created', 'migration_submitted', 'migration_approved',
  'migration_started', 'migration_verified', 'migration_holding', 'migration_failed',
  'restore_requested'
);
create type public.archive_state as enum ('hot', 'warm', 'cool', 'cold', 'frozen', 'protected');
create type public.recommendation_status as enum ('draft', 'ready_for_review', 'approved', 'excluded', 'superseded');
create type public.migration_status as enum ('draft', 'submitted', 'approved', 'copying', 'verifying', 'registering', 'holding', 'completed', 'failed', 'cancelled');

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.console_role not null default 'viewer',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table public.productions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 240),
  external_reference text,
  status text not null default 'active' check (status in ('planned', 'active', 'delivered', 'archived', 'on_hold')),
  delivered_at timestamptz,
  retention_until date,
  archive_state public.archive_state not null default 'warm',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider public.integration_provider not null,
  display_name text not null,
  status public.integration_status not null default 'pending',
  credential_reference text,
  configuration jsonb not null default '{}'::jsonb,
  last_synced_at timestamptz,
  last_error_at timestamptz,
  last_error_summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, provider, display_name)
);

create table public.external_resources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  production_id uuid references public.productions(id) on delete set null,
  integration_connection_id uuid references public.integration_connections(id) on delete set null,
  provider public.integration_provider not null,
  external_id text not null,
  resource_type text not null,
  name text not null,
  external_url text,
  metadata jsonb not null default '{}'::jsonb,
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, provider, external_id, resource_type)
);

create table public.source_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  integration_connection_id uuid references public.integration_connections(id) on delete set null,
  provider public.integration_provider not null,
  provider_event_id text not null,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  payload_sha256 text,
  unique (organization_id, provider, provider_event_id)
);

create table public.activity_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  production_id uuid references public.productions(id) on delete set null,
  source_event_id uuid unique references public.source_events(id) on delete set null,
  kind public.activity_kind not null,
  title text not null,
  detail text,
  severity text not null default 'info' check (severity in ('info', 'advisory', 'warning', 'critical')),
  occurred_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table public.storage_locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  integration_connection_id uuid references public.integration_connections(id) on delete set null,
  provider public.integration_provider not null check (provider in ('aws_s3', 'backblaze_b2', 'wasabi')),
  account_name text not null,
  bucket_name text not null,
  prefix text not null default '',
  region text,
  storage_class text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, provider, account_name, bucket_name, prefix)
);

create table public.storage_inventory_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  storage_location_id uuid not null references public.storage_locations(id) on delete cascade,
  production_id uuid references public.productions(id) on delete set null,
  object_count bigint not null default 0 check (object_count >= 0),
  total_bytes bigint not null default 0 check (total_bytes >= 0),
  estimated_monthly_cost_cents bigint check (estimated_monthly_cost_cents >= 0),
  captured_at timestamptz not null default now(),
  source_reference text
);

create table public.pricing_versions (
  id uuid primary key default gen_random_uuid(),
  provider public.integration_provider not null check (provider in ('aws_s3', 'backblaze_b2', 'wasabi')),
  region text,
  effective_on date not null,
  assumptions jsonb not null,
  source_url text,
  created_at timestamptz not null default now(),
  unique (provider, region, effective_on)
);

create table public.archive_recommendations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  production_id uuid references public.productions(id) on delete set null,
  source_storage_location_id uuid not null references public.storage_locations(id) on delete restrict,
  destination_description text not null,
  status public.recommendation_status not null default 'draft',
  archive_state public.archive_state not null,
  estimated_bytes bigint not null check (estimated_bytes >= 0),
  estimated_objects bigint not null check (estimated_objects >= 0),
  estimated_current_monthly_cost_cents bigint check (estimated_current_monthly_cost_cents >= 0),
  estimated_destination_monthly_cost_cents bigint check (estimated_destination_monthly_cost_cents >= 0),
  estimated_one_time_cost_cents bigint check (estimated_one_time_cost_cents >= 0),
  estimated_restore_hours numeric(8,2) check (estimated_restore_hours >= 0),
  pricing_version_id uuid references public.pricing_versions(id) on delete set null,
  confidence smallint not null check (confidence between 0 and 100),
  evidence jsonb not null default '[]'::jsonb,
  exclusions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.migration_proposals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  archive_recommendation_id uuid references public.archive_recommendations(id) on delete set null,
  source_storage_location_id uuid not null references public.storage_locations(id) on delete restrict,
  destination_description text not null,
  manifest_reference text,
  expected_object_count bigint check (expected_object_count >= 0),
  expected_total_bytes bigint check (expected_total_bytes >= 0),
  hold_days smallint not null default 14 check (hold_days between 1 and 90),
  submitted_by uuid references auth.users(id) on delete set null,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.migration_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  migration_proposal_id uuid not null unique references public.migration_proposals(id) on delete restrict,
  status public.migration_status not null default 'draft',
  operation text not null default 'copy_verify_register_hold' check (operation = 'copy_verify_register_hold'),
  idempotency_key text not null unique,
  verification_summary jsonb not null default '{}'::jsonb,
  hold_expires_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  failure_summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index productions_organization_id_idx on public.productions (organization_id);
create index activity_items_organization_occurred_idx on public.activity_items (organization_id, occurred_at desc);
create index source_events_organization_occurred_idx on public.source_events (organization_id, occurred_at desc);
create index inventory_snapshots_location_captured_idx on public.storage_inventory_snapshots (storage_location_id, captured_at desc);
create index archive_recommendations_organization_status_idx on public.archive_recommendations (organization_id, status);
create index migration_jobs_organization_status_idx on public.migration_jobs (organization_id, status);
create index audit_log_organization_created_idx on public.audit_log (organization_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.is_organization_member(target_organization_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.organization_members
    where organization_id = target_organization_id and user_id = auth.uid()
  );
$$;

create or replace function public.has_organization_role(target_organization_id uuid, permitted_roles public.console_role[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.organization_members
    where organization_id = target_organization_id
      and user_id = auth.uid()
      and role = any(permitted_roles)
  );
$$;

create trigger organizations_set_updated_at before update on public.organizations for each row execute procedure public.set_updated_at();
create trigger organization_members_set_updated_at before update on public.organization_members for each row execute procedure public.set_updated_at();
create trigger productions_set_updated_at before update on public.productions for each row execute procedure public.set_updated_at();
create trigger integration_connections_set_updated_at before update on public.integration_connections for each row execute procedure public.set_updated_at();
create trigger external_resources_set_updated_at before update on public.external_resources for each row execute procedure public.set_updated_at();
create trigger storage_locations_set_updated_at before update on public.storage_locations for each row execute procedure public.set_updated_at();
create trigger archive_recommendations_set_updated_at before update on public.archive_recommendations for each row execute procedure public.set_updated_at();
create trigger migration_proposals_set_updated_at before update on public.migration_proposals for each row execute procedure public.set_updated_at();
create trigger migration_jobs_set_updated_at before update on public.migration_jobs for each row execute procedure public.set_updated_at();

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.productions enable row level security;
alter table public.integration_connections enable row level security;
alter table public.external_resources enable row level security;
alter table public.source_events enable row level security;
alter table public.activity_items enable row level security;
alter table public.storage_locations enable row level security;
alter table public.storage_inventory_snapshots enable row level security;
alter table public.pricing_versions enable row level security;
alter table public.archive_recommendations enable row level security;
alter table public.migration_proposals enable row level security;
alter table public.migration_jobs enable row level security;
alter table public.audit_log enable row level security;

create policy organization_read on public.organizations for select to authenticated using (public.is_organization_member(id));
create policy organization_update on public.organizations for update to authenticated using (public.has_organization_role(id, array['admin']::public.console_role[]));
create policy member_read on public.organization_members for select to authenticated using (public.is_organization_member(organization_id));
create policy member_manage on public.organization_members for all to authenticated using (public.has_organization_role(organization_id, array['admin']::public.console_role[])) with check (public.has_organization_role(organization_id, array['admin']::public.console_role[]));

create policy productions_read on public.productions for select to authenticated using (public.is_organization_member(organization_id));
create policy productions_write on public.productions for insert to authenticated with check (public.has_organization_role(organization_id, array['operator', 'admin']::public.console_role[]));
create policy productions_update on public.productions for update to authenticated using (public.has_organization_role(organization_id, array['operator', 'admin']::public.console_role[]));
create policy integrations_read on public.integration_connections for select to authenticated using (public.is_organization_member(organization_id));
create policy resources_read on public.external_resources for select to authenticated using (public.is_organization_member(organization_id));
create policy events_read on public.source_events for select to authenticated using (public.is_organization_member(organization_id));
create policy activity_read on public.activity_items for select to authenticated using (public.is_organization_member(organization_id));
create policy storage_locations_read on public.storage_locations for select to authenticated using (public.is_organization_member(organization_id));
create policy inventory_read on public.storage_inventory_snapshots for select to authenticated using (public.is_organization_member(organization_id));
create policy pricing_read on public.pricing_versions for select to authenticated using (true);
create policy recommendations_read on public.archive_recommendations for select to authenticated using (public.is_organization_member(organization_id));
create policy recommendations_manage on public.archive_recommendations for update to authenticated using (public.has_organization_role(organization_id, array['operator', 'approver', 'admin']::public.console_role[]));
create policy proposals_read on public.migration_proposals for select to authenticated using (public.is_organization_member(organization_id));
create policy proposals_submit on public.migration_proposals for insert to authenticated with check (public.has_organization_role(organization_id, array['operator', 'approver', 'admin']::public.console_role[]));
create policy proposals_approve on public.migration_proposals for update to authenticated using (public.has_organization_role(organization_id, array['approver', 'admin']::public.console_role[]));
create policy jobs_read on public.migration_jobs for select to authenticated using (public.is_organization_member(organization_id));
create policy audit_read on public.audit_log for select to authenticated using (public.has_organization_role(organization_id, array['approver', 'admin']::public.console_role[]));

revoke all on function public.is_organization_member(uuid) from public;
revoke all on function public.has_organization_role(uuid, public.console_role[]) from public;
grant execute on function public.is_organization_member(uuid) to authenticated;
grant execute on function public.has_organization_role(uuid, public.console_role[]) to authenticated;

-- Alpha safety guard: no table, policy, procedure, or scheduled task in this
-- migration can delete source media. Jobs are limited to copy, verify,
-- register, and hold. Any future deletion workflow requires a separate,
-- explicitly approved migration and release.
