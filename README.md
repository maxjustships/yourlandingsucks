# YourLandingSucks

[![CI](https://github.com/maxjustships/yourlandingsucks/actions/workflows/ci.yml/badge.svg)](https://github.com/maxjustships/yourlandingsucks/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)

Your website is public. Its failure modes should not stay invisible.

YourLandingSucks (`yls`) gives your coding agent a deterministic browser-audit,
monitoring, issue, and verification layer for every public site attached to a
project. The agent supplies the intelligence; YLS supplies reproducible evidence
and guardrails. No separate model account or model API key is required.

## Why it exists

Every public site needs an explicit description of what it is for, whom it
serves, which journeys matter, and which pages are in or out of scope. That is
the starting point for **all** sites, not a fallback for products with little
traffic.

YLS then adapts the strength of its conclusions to the evidence available:

- `ready`: establish the site's scope, mechanics, accessibility, performance,
  critical journeys, and measurement readiness;
- `listen`: combine those invariants with behavioral signals without pretending
  they prove causality;
- `optimize`: prepare and verify experiments after explicit traffic and
  conversion thresholds are met.

Traffic changes what can be concluded. It does not change whether the site must
first be understood.

## Install

Open your coding agent in the project you want to monitor and paste this entire
prompt:

```text
Install package `yourlandingsucks` at the exact version `0.1.0-alpha.1` from the official public npm registry `https://registry.npmjs.org/` as a project-local development dependency in this repository. Never install it globally, from GitHub, from a branch, or at another version. Use this repository's existing JavaScript package manager and its exact-version flag. If this repository has no JavaScript package manifest, create a minimal private npm manifest used only for local developer tooling, then run `npm install --save-dev --save-exact --registry=https://registry.npmjs.org/ yourlandingsucks@0.1.0-alpha.1`; do not alter the application's runtime or deployment package manager. Invoke only the installed project-local binary and run `npx --no-install yls agent install --json`, then read and follow `.agents/skills/yourlandingsucks/SKILL.md`. Inspect this repository and its deployment configuration to discover every public website it owns. Inspect each public site read-only and infer a separate safe scope, purpose, critical journeys, exclusions, monitoring schedule, and autonomy policy. Present one onboarding proposal grouped by site, clearly mark assumptions, and ask me only for decisions that cannot be safely inferred. Do not activate any site until I confirm its proposal. If recurring monitoring is requested after confirmation, prepare the external automation plan, ask before creating or changing that automation, register only an external automation that was actually created, run one safe heartbeat, and do not call monitoring active until its status is healthy. If the browser check fails, explain the required local browser download and ask before applying its remediation. Do not submit forms, deploy, push, send feedback, or make product changes during onboarding. Keep YLS commands, configuration, artifacts, and state internal; after onboarding I will manage it only with natural-language requests through my agent.
```

There is nothing to configure before pasting it. The agent installs the local
tool and a durable project capability, proposes the sites and their rules, and
asks the smallest useful set of questions. Site confirmation does not pretend
to create a scheduler. When recurring monitoring is requested, the agent must
create an external automation with separate permission, register its real ID,
run a heartbeat, and verify that YLS reports it healthy. Fresh compatible agent
sessions can then respond to ordinary requests such as “check my public pages,”
“suggest three improvements,” or “watch this every weekday.”

## Why you should care

Generated sites make shipping a new page almost free. They do not make noticing
what broke any easier. A form can stop working, a primary action can disappear
on mobile, copy can drift away from the product, or a new route can become
inaccessible while every deployment still reports green.

Those failures rarely arrive as a clean bug report. They show up as visitors
who do not understand the promise, do not trust the page, or leave before doing
the thing the page exists for. With little traffic, analytics cannot explain
why. With more traffic, waiting for a dashboard means paying for the mistake
until enough people have encountered it.

YLS gives the coding agent a memory and a feedback loop for every public
surface: what the page is meant to do, what must never regress, what evidence
was observed, which change was attempted, and whether a preview actually fixed
it. You ask in natural language; the agent does the auditing, prioritization,
bounded implementation, and verification without turning you into the operator
of another testing stack.

## Agent compatibility

- **Codex and Agent-Skill/`AGENTS.md`-aware agents:** durable discovery is
  forward-tested.
- **Other agents that honor `AGENTS.md`:** expected to discover the same local
  capability; report incompatibilities as bugs.
- **Other shell-capable coding agents:** the copy-paste onboarding works for the
  current session, but durable rediscovery is not claimed until that agent's
  instruction surface is tested.

## Current V0

- discovers same-origin public pages from sitemaps and rendered navigation;
- supports several sites with separate scopes, goals, schedules, rules, and
  artifact histories;
- renders desktop and mobile pages in a real browser;
- checks HTTP behavior, redirects, runtime errors, failed requests, headings,
  forms, overflow, calls to action, accessibility, and synthetic performance;
- keeps deterministic defects separate from heuristic risks, behavior signals,
  and experiment results;
- turns findings into a bounded local issue queue and verifies fixes against a
  preview before closing them;
- watches confirmed sites on cron schedules and reports route, title, heading,
  status, and finding changes when an external scheduler invokes the registered
  watch plan;
- accepts optional aggregate analytics from a local snapshot or PostHog;
- keeps telemetry off, prepares strict sanitized upstream feedback only after
  an explicit request, and records the external submission receipt;
- provides a provider-neutral daily maintainer lifecycle that validates
  incoming reports, deduplicates them, gates product decisions, and lets an
  agent prepare at most one tested draft fix per run.

## The agent loop

```text
project + public sites
          |
          v
 agent proposes scope and rules
          |
          v
       human confirms
          |
          v
 YLS captures evidence and issues
          |
          v
 agent changes one causal thing
          |
          v
 YLS verifies a preview
       /           \
   failed          passed
     |                |
 issue stays open   issue closes
```

Recurring monitoring uses the same loop. YLS decides what is due and records
the evidence; an external agent automation or scheduler invokes the plan. YLS
tracks its registration and heartbeat, while the coding agent interprets
natural-language rules and stays inside the autonomy level confirmed for each
site.

When a project reports a YLS false positive, tool failure, or missing
capability, the same pattern continues upstream. The project agent prepares a
privacy-reviewed bundle and, after approval, submits it using the human's
existing GitHub access. A separately registered maintainer agent validates and
triages those reports once per day, prepares only bounded draft fixes, and
returns the released version to the originating project's receipt.

## V0 limitations

- This is a local CLI and Agent Skill, not a hosted SaaS or background daemon.
- YLS does not create a scheduler by itself; the agent composes that workflow
  from the host's automation primitive after explicit permission.
- The upstream maintainer also depends on a registered external agent
  automation; heartbeat state detects missing, stale, changed, and failed runs.
- Only Codex-style Agent Skill/`AGENTS.md` persistence is forward-tested today.
- Heuristic recommendations and behavioral signals are hypotheses, not proven
  conversion lift.
- Production deployment, form submission, paid resources, and feedback export
  always require separate authority.
- The prerelease artifact and CLI schemas may change before `1.0.0`.

## Trust boundary

YLS audits public URLs and writes local artifacts. It does not need source-host,
deployment, or model-provider credentials, and it never submits production
forms. Raw runs may contain public copy, URLs, console output, and screenshots,
so they stay ignored locally by default. See [SECURITY.md](SECURITY.md) for the
complete boundary.

## License

Apache-2.0. See [LICENSE](LICENSE).
