# PostOpz Virtual Edit Studio — Provisioning Runbook (pilot v1)

## Current execution boundary
- The published configurator estimates Essential, Production and Studio subscriptions.
- `POST /api/studio/quote` recomputes the estimate on the server; it never bills a customer or creates a vendor resource.
- A verified Netlify form submission triggers `studio-intake`. A server-repriced, immutable request manifest is saved as `postopz-studio-requests/requests/<id>.json` in **Netlify Blobs**, where an operator with Netlify access can review it.
- The customer is given an inquiry confirmation only. **No vendor account, VM, filespace, MAM access, or license is provisioned automatically.**
- `STUDIO_EVENT_PROCESSING_ENABLED=true` must be scoped to **production Netlify Functions only**. Preview deployments must not write real lead data.
- Intake records are immutable. Netlify Forms is the live source of customer-submitted fields. Netlify Blobs is only for per-request configuration documents, NOT financial balances or transactional state. For lifecycle transitions use PostOpz's own relational database with an auditable approval trail.

## Workstation vendor: Vagon Teams
Current Machines API: https://docs.vagon.io/teams/reference/machines
HMAC authentication: https://docs.vagon.io/teams/reference/how-to-use-teams-api
**Documentation discrepancy:** The older Teams API guide still describes `POST /organization-management/v1/seats` using `seat_plan_id`. The current Machines API documents **`POST /organization-management/v1/machines`** with **`plan_id`**, `region`, `quantity` and optional `software_ids`/`base_image_id`. Do not mix the two schema generations; confirm the current account's contracted version with Vagon.
- A Vagon Teams account with **at least one Team Computer** is required before the Teams API Public Key and Secret Key are available under Teams dashboard **Settings**.
- Configure secrets only under Netlify's **production Functions scope**:
  - `VAGON_TEAMS_API_PUBLIC_KEY`
  - `VAGON_TEAMS_API_SECRET_KEY`
  - `STUDIO_OPERATOR_TOKEN` (an independently generated random token of at least 43 characters)
- Never paste API secrets into public HTML, GitHub, chat messages, analytics or forms.
- The signed payload is `publicKey + uppercase HTTP method + request path including initial / + UTC milliseconds + nonce + exact request body`; the result is HMAC SHA256 hex.
- The server-only library at `netlify/functions/lib/vagon-teams.mjs` supports **only listing machines and software**. `draftVagonMachine` assembles an unexecutable request, with `executionEnabled: false`.
- The operator-only `POST /api/studio/internal/vagon-health` endpoint requires production context, `Authorization: Bearer <STUDIO_OPERATOR_TOKEN>` and both Vagon keys. It lists machines but returns only summary counts; no customer data or access links. Until secrets are configured it is disabled / unconfigured.
- Only after contract and budget approval can we add a privileged `POST /machines` provisioning operation. **Vagon says machine creation charges the organization's balance.** Never submit before customer-signed quote, client-owner authorization, a bounded spend ceiling and an idempotent approval ledger.
- Inventory approved plan IDs, machine performance settings, app images, regions, codecs, network/egress behavior and negotiated volume pricing. Vagon must confirm managed-service/resale terms.
- Associate machine ID and customer/project only inside a private transactional PostOpz database; never in a public form response.
- Perform any start/stop/access generation under separate operator role checks and usage limits; no shareable access link may appear in diagnostics.
- Enforce auto-stop, session allowances, monthly spend cap, explicit audit entries and emergency suspension.

## LucidLink
Official API: https://developer.lucidlink.com/docs/lucid-api/reference/overview
- Confirm appropriate workspace / partnership permission and service-account bearer token.
- Filespace creation: `POST /api/v1/filespaces`; verify supported provider/region before calling.
- Assign least-privilege members/groups and `/filespaces/{filespaceId}/permissions`, after customer tenant ownership and isolation have been approved.
- Validate actual storage and filepaths on the provisioned machine before editor handoff.

## iconik
Official API: https://app.iconik.io/docs/api.html
- Create a restricted service-account user with an application/token; do not use an administrator user in production.
- Verify collection policies, access rules, storage gateway connectivity, LucidLink indexing capability and enterprise licensing terms.
- Create project collections and map permitted users only after group and tenant checks.

## Pilot onboarding approval gates
1. Review request in Netlify Forms and its companion manifest in Netlify Blobs.
2. Confirm customer identity, jurisdiction, media ownership, NLE compatibility and actual start date.
3. Replace the **nonbinding website estimate** with a formal quote listing taxes, licenses, compute, storage, egress and backups.
4. Receive explicit customer consent for the quote, subscription terms and cloud usage ceiling.
5. Verify Vagon, LucidLink and iconik terms, credentials and vendor-plan quotes.
6. Approve media staging, project segregation, MFA, backup and access controls.
7. Only after the above: request privileged provisioning execution with provider-specific idempotency and audit logs.
8. Open project and play media; test export, audio, sync and editor handoff. Start the 30-minute handoff clock only after prerequisites are satisfied.

## Later technical phase
- Add a PostOpz-only authenticated Console module and its own isolated database.
- Track request states: `requested -> qualified -> quote_sent -> approved -> provisioning -> readiness_check -> active -> suspended -> archived`.
- Enforce role-based access, tenant isolation, signed approval, immutable audit events, and explicit emergency shutdown.
- Implement provider adapters with separate `dryRun`, `preflight`, and `execute` operations. A user-facing request can only invoke `dryRun`.
- Never put service-account credentials, HMAC secrets, access links, customer personal data or provider API keys in public static assets or frontend logs.

## Operational release checks
- Netlify production deploy status READY, site homepage and all Framework routes render as before.
- `/virtual-edit-studio/` shows all three tiers and the responsive quote estimate.
- Server quote endpoint accepts a valid baseline configuration and rejects invalid hour/storage quantities.
- Netlify Forms recognizes the intake fields; manually submit a verified inquiry to confirm event handling and Blob persistence.
- Ensure the published `/netlify/functions/` static path cannot expose server source files.
- Configure form submission notifications in Netlify UI and confirm with a human-owned email.
- Run a real Vagon/Adobe/LucidLink/iconik pilot under bounded paid access before describing instant activation as live.

## Pricing note
Essential: $599/month; Production: $1499/month; Studio: $2999/month. These are directional prices until supplier contracts are executed. An additional shared TB is +$149/month; additional hour blocks are 20/40/80 priced at the tier's GPU surcharge; custom standards add $249 one-time. One-time base onboarding: $299 Essential and Production, $499 Studio.
