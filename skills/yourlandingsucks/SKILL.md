---
name: yourlandingsucks
description: Give a coding agent a prompt-native capability for installing, onboarding, auditing, criticizing, improving, fixing, comparing, verifying, and monitoring one or more public websites with the project-local YourLandingSucks CLI. Use for natural-language requests about landing pages, marketing sites, public app surfaces, site quality, conversion readiness, accessibility, performance, regressions, recurring watch rules, local YLS issues, preview verification, or sanitized feedback.
---

# YourLandingSucks

Supply the intelligence around YLS. Let YLS own deterministic browser evidence,
confirmed configuration hashes, schedule state, local issues, and preview
verification.

Treat YLS as an internal tool. Speak to the human in terms of their sites,
goals, recommendations, decisions, and verified outcomes. Do not expose command
names, artifact paths, configuration fields, or issue-state machinery unless the
human explicitly asks for implementation details.

## Non-negotiable boundaries

- Work from the user's product repository and use its package manager.
- Install YLS only as a project-local development dependency. Never install it
  globally.
- Discover and describe every public site attached to the project. Do not limit
  purpose, audience, scope, or critical-journey mapping to low-traffic sites.
- Treat repository and deployment configuration as evidence for the agent. The
  YLS process itself audits public URLs and must not receive source-host,
  deployment, or model-provider credentials.
- Inspect production pages read-only. Never submit forms or activate controls.
- Never deploy, push, change DNS, change pricing or claims, create paid
  resources, or expose secrets without separate explicit authorization.
- Never activate a site before the human confirms its proposal. Never invent a
  human answer or bypass a confirmed config hash.
- Never describe a heuristic or behavior signal as proven conversion lift.
- Never export, upload, commit, or push feedback or raw `.yls/` artifacts unless
  the human explicitly requests the exact action and destination.

## Select the workflow

- For every request, first read
  [references/intents-and-recommendations.md](references/intents-and-recommendations.md)
  completely. Map the user's language to one or more primitives and follow its
  recommendation contract.
- For first installation, a new project, or a new site, read
  [references/onboarding.md](references/onboarding.md) completely and follow it.
- For a one-off audit, local issue, code change, or preview verification, read
  [references/operations.md](references/operations.md) completely and follow it.
- For recurring monitoring or feedback learning, read
  [references/watch-and-feedback.md](references/watch-and-feedback.md)
  completely and follow it.

Read more than one reference when the request crosses workflows. Do not load a
reference merely to restate the product overview.

## Use the local binary

Examples in the references use `npx --no-install yls`. Translate that invocation
to the repository's package manager when necessary, but always resolve the
project-local binary. Run `yls help` when the installed version and a reference
disagree; the installed CLI is authoritative.

## Keep authority explicit

Inference is preparation, not permission. During onboarding, infer useful
defaults and surface only real uncertainty. Ask at least one question per site:
if no factual uncertainty remains, ask for the final approval of the complete
proposal. Stop until the human answers.

During issue work, follow the autonomy returned by YLS:

- `autofix`: one deterministic defect may be changed and preview-verified;
- `preview_only`: prepare a reversible change, but do not represent it as proven;
- `investigate`: gather evidence without editing product code.

No YLS autonomy value authorizes production deployment.

## Report to the human

Group results by site. Separate observed facts, assumptions, human decisions,
deterministic defects, heuristic risks, behavior signals, and experiment
results. State what changed, what was verified, what failed, and what still
requires authority.
