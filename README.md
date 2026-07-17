# YourLandingSucks

[![CI](https://github.com/maxjustships/yourlandingsucks/actions/workflows/ci.yml/badge.svg)](https://github.com/maxjustships/yourlandingsucks/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)

Your website is public. Its failure modes should be, too.

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
Install YourLandingSucks in this repository from git+ssh://git@github.com/maxjustships/yourlandingsucks.git#main as a project-local development dependency. Run its project-local `yls agent install --json`, then read and follow `.agents/skills/yourlandingsucks/SKILL.md`. Inspect this repository and its deployment configuration to discover every public website it owns. Inspect each public site read-only and infer a separate safe scope, purpose, critical journeys, exclusions, monitoring schedule, and autonomy policy. Present one onboarding proposal grouped by site, clearly mark assumptions, and ask me only for decisions that cannot be safely inferred. Do not activate any site until I confirm its proposal. Do not submit forms, deploy, push, export data, or make product changes during onboarding. Keep YLS commands, configuration, artifacts, and state internal; after onboarding I will manage it only with natural-language requests through my agent.
```

There is nothing to configure before pasting it. The agent installs the local
tool and a durable project capability, proposes the sites and their rules, asks
the smallest useful set of questions, and waits for confirmation before
monitoring becomes active. Fresh agent sessions can then discover YLS from the
project and respond to ordinary requests such as “check my public pages,”
“suggest three improvements,” or “watch this every weekday.”

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
  status, and finding changes;
- accepts optional aggregate analytics from a local snapshot or PostHog;
- keeps telemetry off and exports sanitized feedback only after an explicit
  request.

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
the evidence; the coding agent interprets natural-language rules and stays
inside the autonomy level confirmed for each site.

## Trust boundary

YLS audits public URLs and writes local artifacts. It does not need source-host,
deployment, or model-provider credentials, and it never submits production
forms. Raw runs may contain public copy, URLs, console output, and screenshots,
so they stay ignored locally by default. See [SECURITY.md](SECURITY.md) for the
complete boundary.

## License

Apache-2.0. See [LICENSE](LICENSE).
