-- Slack alpha: adds a non-destructive normalized activity kind only.
-- Apply after the Console alpha migration. No provider credentials, message
-- text, or Slack files are stored in Supabase by this migration.

alter type public.activity_kind add value if not exists 'message_received';
