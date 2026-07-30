# PostOpz Premiere Presence — alpha setup

This companion panel makes a normal `.prproj` visible to its mapped PostOpz Console production. It reports only editor name, the open project name, active sequence name when Premiere exposes it, Premiere version, and a time of last activity. It does not upload media, project contents, full file paths, or Adobe credentials.

## 1. Apply the Console database migration

In Supabase **SQL Editor**, run:

`supabase/migrations/20260731090000_premiere_presence.sql`

The warning about new tables is expected. This migration creates Console metadata only; it cannot affect Premiere or any source media.

## 2. Pair a workstation from Console

1. Open **Console → Productions → Second_Smile** as a PostOpz Operator.
2. In **Premiere Presence**, name the workstation, for example `Michael — Edit Bay`.
3. Select **Create pairing**.
4. Copy the one-time **workstation ID** and **pairing token** immediately. Treat the token like a device password; Console does not retain a readable copy.

## 3. Load the local panel in Adobe Premiere 26.3

1. Install/open Adobe **UXP Developer Tool** (version 2.2 or newer).
2. Choose **Add Plugin**, select the repository folder `premiere-presence`, then **Load** it.
3. In Premiere, open **Window → UXP Plugins → PostOpz Presence**.
4. Enter:
   - **Console presence endpoint:** `https://deploy-preview-2--postopz.netlify.app/console/premiere/presence`
   - the workstation ID and pairing token from Console
   - your display name, for example `Michael Newton`
5. Select **Save pairing and send now**. Leave the panel open while editing; it reports once per minute.

If the one-time token is lost before the panel is paired, return to the
production's **Premiere Presence** section and select **Reissue token** next to
that workstation. This immediately replaces the old token with a new one; the
original token is intentionally never stored in readable form.

## Operational model

Each editor workstation reports its own presence. A standard `.prproj` does not itself reveal who has it open elsewhere, so this approach is intentionally explicit and production-scoped. Console treats a heartbeat as **active** for two minutes, then displays it as **away** until the next report.

To stop reporting, close the panel or unload the plugin. In a later alpha we can add an Operator-only revoke control that invalidates a paired workstation token.
