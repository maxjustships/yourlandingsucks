# Contributing

A change is not complete because it looks plausible. Add automated evidence for
the affected behavior and preserve the product boundaries below.

```bash
npm ci
npm run verify:v0
```

Rules for the core:

- no model-provider SDK or hidden model call;
- no repository search or source ingestion;
- no automatic telemetry or feedback upload;
- no production form submission;
- no causal language for heuristic evidence;
- preserve versioned artifact compatibility or deliberately bump the schema;
- retain a non-zero verification exit code for new guardrail regressions.

The fixture server contains deliberate defects. Add a seeded defect and a
negative/fixed case when introducing a new browser rule.

Multi-site/onboarding/watch changes must preserve the legacy single-config
path and extend `multi-site-watch.test.mjs` with both a successful site and an
edge case. Never weaken the human-answer/config-hash gate to make a scheduler
test easier. Cron changes need timezone, duplicate-minute, and DST coverage.

Human-facing setup stays in the single copy-paste prompt in `README.md`. It must
not require placeholders, tokens, or pre-filled configuration. Operational
instructions belong in `skills/yourlandingsucks/`; keep that skill packable and
validate it whenever its workflow changes.

Agent-integration changes must prove idempotent installation, preservation of
unrelated `AGENTS.md` content, drift repair, and refusal of unmanaged,
malformed, or symlinked targets. Keep the human-facing contract prompt-native:
the agent may use commands and artifacts internally, but must translate them
into site outcomes and product decisions. Run the packaged install smoke and a
fresh-session agent test when that discovery contract changes.

Watch activation changes must cover unregistered, pending, healthy, stale,
failed, schedule-changed, and removal states. Never infer an external scheduler
exists from a confirmed cron alone.

Before a release, run `npm run release:check`, the Agent Skill validator, a full
history secret scan, and a blind fresh-session test. Release tags are immutable;
do not point human installation at `main`.

After publishing to npm, run `npm run smoke:public-install` to verify the exact
copy-paste installation path against the public registry.
