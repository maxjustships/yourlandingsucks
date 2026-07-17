# Watch and feedback workflow

Use this workflow to create, verify, operate, or remove recurring monitoring.
YLS owns the plan, registration receipt, heartbeat, evidence, and guardrails.
The agent owns intelligence and uses a scheduler capability available in its
host or project.

## Activate a watch

Get the structured plan:

```bash
npx --no-install yls watch plan --json
```

For every site, translate the schedule, rules, autonomy, proposed scheduler,
repository access, and failure-notification behavior for the human. Choose a
maximum heartbeat silence longer than the normal interval plus a reasonable
retry margin. Ask before creating or changing any external automation.

After approval, create the automation using the host's supported mechanism.
Schedule the exact structured `invocation` returned by the plan; do not rebuild
its arguments from memory. Only after the scheduler confirms creation and
returns a stable identifier, record it:

```bash
npx --no-install yls watch register --site SITE_ID --provider PROVIDER --external-id EXTERNAL_ID --max-silence-minutes MINUTES --json
```

Trigger the registered automation once or run its exact invocation once. Then
verify:

```bash
npx --no-install yls watch status --site SITE_ID --json
```

Say monitoring is active only for a `healthy` site. `pending_first_run` means
the external automation is recorded but unproven. `stale`, `failed`,
`schedule_changed`, and `not_registered` all require attention. If external
creation fails, do not register it and do not claim partial success.

## Scheduled watch

At each scheduled invocation, run the exact per-site command from `watch plan`.
For a coordinating scheduler that intentionally polls all sites, run:

```bash
npx --no-install yls watch tick --json
```

Do not edit confirmed site configs, `yls.workspace.yaml`, registration receipts,
or watch state to make a site due or bypass onboarding. Report every site
failure and continue with successful packets.

For each packet, evaluate only its current evidence, delta, and confirmed
natural-language rules:

- `observe`: report the matched condition; do not edit code;
- `propose`: prepare a reversible proposal and name the human decision needed;
- `autofix_verified_defects`: claim one deterministic defect, implement one
  causal change, run project checks, and preview-verify it using the issue
  workflow.

No watch policy authorizes deployment, push, DNS changes, pricing or claim
changes, paid resources, form submission, or secret exposure. Stop after three
handled issues across the entire invocation.

YLS deduplicates each site's scheduled local minute, isolates failures, and
reports changes to routes, finding rules, titles, H1s, and HTTP status.

Check health when the user asks whether monitoring is running. If a confirmed
schedule changes, replace or update the external automation and register its
new ID/fingerprint before calling it active again.

To remove monitoring, remove the external automation first. Only after the host
confirms deletion, clear the local receipt:

```bash
npx --no-install yls watch unregister --site SITE_ID --json
```

## Feedback

Claims, blocks, rejections, verification outcomes, and recurrence are written
to the local ledger automatically and influence later issue selection.

Never export feedback as part of a normal audit or watch. When the human
explicitly requests an export and names a destination, run:

```bash
npx --no-install yls feedback export --run RUN_ID --output CHOSEN_FILE --json
```

Show the exact sanitized payload and destination before any separate upload,
commit, or push. Those actions require their own authorization.

To improve YLS across reviewed project exports, aggregate only an explicitly
selected inbox:

```bash
npx --no-install yls feedback aggregate --input REVIEWED_INBOX --output RULE_HEALTH.json --json
```

Treat the result as evidence for rule-development issues. Never let aggregation
silently suppress or rewrite an audit rule.
