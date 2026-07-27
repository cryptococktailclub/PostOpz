-- Slack alpha: adds a non-destructive normalized activity kind only.
-- Apply after the Console alpha migration. No provider credentials or Slack
-- files are stored in Supabase by this migration. Selected public-channel
-- message excerpts are stored in existing event/activity JSON by the function.

alter type public.activity_kind add value if not exists 'message_received';
alter type public.activity_kind add value if not exists 'message_sent';
