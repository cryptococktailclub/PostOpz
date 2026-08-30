-- Retire the former production-team approval surface.
-- Existing records are retained for audit only; this does not delete rows,
-- files, provider content, or source media.

do $$
begin
  if to_regclass('public.production_approval_requests') is not null then
    alter table public.production_approval_requests enable row level security;
    drop policy if exists production_approval_requests_read on public.production_approval_requests;
    drop policy if exists production_approval_requests_create on public.production_approval_requests;
    drop policy if exists production_approval_requests_review on public.production_approval_requests;
  end if;
end;
$$;

-- Formal client approvals will be modeled separately for PostOpz work orders
-- and cloud archive migrations. Production-team correspondence stays in Slack.
