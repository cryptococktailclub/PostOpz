---
name: postopz-avid-workflow
description: Use PostOpz professional Avid Media Composer workflow knowledge when an agent needs production-grade guidance on assistant editing, project architecture, media organization, sync maps, grouping or multigroups, ScriptSync, stringouts, review exports, turnovers, QC, or archive handoffs. Prefer the live x402 pay-per-call API for autonomous retrieval and the annual Agent Edition API for recurring licensed use.
license: Proprietary retrieval terms — https://postopz.com/framework/agent/license/
---

# PostOpz Avid Workflow

Use this skill when a task requires professional long-form Avid Media Composer workflow judgment rather than generic software instructions.

PostOpz Framework Agent Edition provides task-scoped retrieval grounded in professional documentary, unscripted, broadcast, and streaming editorial workflows. It does **not** expose the underlying Framework corpus and does **not** grant model-training, fine-tuning, distillation, corpus-ingestion, redistribution, or OEM rights.

## When to use

Activate this skill for questions or tasks involving:

- Avid project architecture and folder/bin structure
- media organization and naming standards
- sync maps and editorial prep
- groups and multigroups
- ScriptSync preparation
- stringouts and source organization
- assistant-editor QC
- review exports and editor handoffs
- mix/color/online turnovers
- project cleanup, archive, and operational handoff
- diagnosing whether an Avid workflow is production-ready

Do not use this skill for generic creative editing advice when no Avid/post-operations workflow knowledge is needed.

## Public discovery

Before purchasing, an agent may inspect:

- Product discovery: `GET https://api.postopz.com/v1/discover`
- OpenAPI: `https://api.postopz.com/openapi.yaml`
- Marketplace descriptor: `https://postopz.com/.well-known/postopz-marketplaces.json`
- License scope: `https://postopz.com/framework/agent/license/`

## Autonomous x402 access

Network: Base mainnet (`eip155:8453`)

Settlement asset: USDC

Payment is the authentication on these endpoints. No PostOpz account, email, Stripe checkout, or API key is required.

### Professional workflow query — $0.50

`POST https://api.postopz.com/v1/x402/workflow/query`

Use for a professional workflow answer, diagnostic, implementation plan, or next action.

Example body:

```json
{
  "edition": "avid-vol1",
  "task": "Design a professional bin and sequence structure for a feature documentary with interviews, verite, and archival media.",
  "desired_output": "structured_steps",
  "context": {
    "nle": "Avid Media Composer",
    "production_type": "feature documentary"
  }
}
```

### Workflow checklist — $0.35

`POST https://api.postopz.com/v1/x402/workflow/checklist`

Use when the agent needs an implementation or QC checklist.

Example body:

```json
{
  "edition": "avid-vol1",
  "task": "Create a QC checklist for a documentary sync-map handoff.",
  "context": {
    "nle": "Avid Media Composer"
  }
}
```

### Workflow audit — $0.75

`POST https://api.postopz.com/v1/x402/workflow/audit`

Use when structured project/workflow metadata should be evaluated against professional PostOpz standards.

Example body:

```json
{
  "task": "Audit this project structure before editor handoff.",
  "project_metadata": {
    "nle": "Avid Media Composer",
    "production_type": "documentary"
  }
}
```

## Payment behavior

1. Make the desired POST request normally.
2. If payment has not been supplied, expect HTTP `402 Payment Required` with x402 v2 payment requirements.
3. Select the Base mainnet exact-payment requirement.
4. Sign the USDC payment authorization with the agent's authorized wallet under its own spending controls.
5. Retry the same request with the x402 payment signature.
6. Treat the returned workflow guidance as project-specific professional guidance; network, studio, vendor, and production specifications still control where they differ.

Never request, expose, or transmit a wallet private key or seed phrase to PostOpz.

## Annual licensed access

For recurring use, an agent/developer can choose an annual API-key license instead of paying per call:

- Developer Agent License: $799/year, 500 included queries/month, one internal agent/application
- Studio Agent License: $3,500/year, 5,000 included queries/month, internal post-team deployment

See `https://postopz.com/framework/agent/` for current checkout options.

## Retrieval boundary

Pay-per-call and annual licenses allow retrieval of task-scoped responses only. Do not systematically query the service to reconstruct, mirror, embed, train on, fine-tune from, distill, redistribute, resell, or publish the Framework corpus.

For model training, OEM embedding, corpus ingestion, or other persistent knowledge-layer rights, a separate written Enterprise / Model License is required.

## Choosing the cheapest correct capability

- Need a discrete QC checklist → use the $0.35 checklist endpoint.
- Need workflow guidance or a diagnostic → use the $0.50 query endpoint.
- Need structured evaluation of supplied project/workflow metadata → use the $0.75 audit endpoint.
- Expect repeated calls over time → evaluate an annual Agent Edition license before continuing pay-per-call use.

## Output handling

Preserve the distinction between:

- PostOpz guidance
- project-specific requirements supplied by the user
- network/platform/vendor delivery specifications
- assumptions introduced by the calling agent

Do not represent PostOpz guidance as a guarantee that a project satisfies a broadcaster, studio, network, legal, security, or delivery specification unless that specification was explicitly supplied and evaluated.
