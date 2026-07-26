# Workspace Files alpha setup

## Apply the Supabase migration

In Supabase **SQL Editor**, open and run:

`supabase/migrations/20260727014500_workspace_files.sql`

It creates a private `console-workspace-files` bucket and the metadata table
used by Console. The alpha accepts operational paperwork only, with a 5 MB
maximum per upload. It has no delete action or source-media capability.

## What operators can upload

- PDFs, text files, CSVs, XMLs, JSON files
- Word and Excel documents
- EDL files (use the `.edl` extension)
- Scripts, briefs, turnovers, delivery specifications, call sheets, schedules

Use **Workspace Files** in Console to assign a document to a workspace and,
optionally, a registered production. Each upload records its document type and
version label. Files are stored privately and downloads use short-lived signed
links.

Google Drive remains a separate read-only browsing source in the same Console
area. Uploading a Console workspace file does not write into Google Drive.
