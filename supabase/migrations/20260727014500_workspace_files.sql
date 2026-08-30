-- PostOpz Console workspace files alpha
-- Private operational paperwork only. This does not store source media and
-- does not grant any delete capability to Console users.

create table public.workspace_files (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  production_id uuid references public.productions(id) on delete set null,
  storage_path text not null unique,
  file_name text not null check (char_length(file_name) between 1 and 240),
  content_type text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 5242880),
  document_type text not null check (document_type in ('brief', 'script', 'turnover', 'edl', 'xml', 'delivery_spec', 'call_sheet', 'schedule', 'other')),
  version_label text check (char_length(version_label) <= 80),
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index workspace_files_organization_created_idx on public.workspace_files (organization_id, created_at desc);
create index workspace_files_production_created_idx on public.workspace_files (production_id, created_at desc);

create trigger workspace_files_set_updated_at before update on public.workspace_files
for each row execute procedure public.set_updated_at();

alter table public.workspace_files enable row level security;

create policy workspace_files_read on public.workspace_files
for select to authenticated
using (public.is_organization_member(organization_id));

-- Uploads are performed only by the private Netlify function using the
-- Supabase secret key after it verifies the Console session and operator role.
-- There is deliberately no user-facing delete policy in this alpha.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'console-workspace-files',
  'console-workspace-files',
  false,
  5242880,
  array[
    'application/pdf', 'text/plain', 'text/csv', 'text/xml', 'application/xml',
    'application/json', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/octet-stream'
  ]
)
on conflict (id) do nothing;

-- No storage.objects policy is created: the bucket is private and downloads
-- are issued as short-lived signed URLs only after server-side access checks.
