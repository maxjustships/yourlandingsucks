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

Prepare upstream feedback when the human says a YLS result is wrong, a YLS
operation fails, or a missing YLS capability creates repeated manual work. Do
not confuse feedback about the public site with feedback about YLS itself.

For reviewed finding outcomes, prepare a rule bundle from the relevant run:

```bash
npx --no-install yls feedback prepare --type rule_outcome --run RUN_ID --site SITE_ID --json
```

For a YLS tool failure, summarize the behavior without a URL, repository name,
local path, code, credential, screenshot, stack trace, or copied page content:

```bash
npx --no-install yls feedback prepare --type tool_bug --summary SAFE_SUMMARY --operation SAFE_OPERATION --error-code SAFE_ERROR_CODE --json
```

For a product request, prepare only the smallest generic capability statement:

```bash
npx --no-install yls feedback prepare --type feature_request --summary SAFE_SUMMARY --json
```

YLS rejects obvious URLs, paths, credentials, unknown fields, and modified
fingerprints. It returns the exact bundle plus a provider-neutral submission
plan. Inspect both. Show the human the destination, title, and complete JSON;
ask for the single decision “send this sanitized report?” Never add free-form
project context to the generated issue body.

After approval, use the agent host's existing GitHub capability to create the
issue exactly from `submission.repository`, `submission.labels`,
`submission.title`, and `submission.body`. YLS must not receive a GitHub token.
Record the real external receipt only after GitHub confirms creation:

```bash
npx --no-install yls feedback register --report REPORT_ID --provider github --external-id ISSUE_ID --external-url ISSUE_URL --json
```

If creation fails, leave the report `prepared` and say it was not sent. Never
register an invented issue. Check local receipts when the human asks what
happened to submitted feedback:

```bash
npx --no-install yls feedback status --report REPORT_ID --json
```

When the upstream provider reports a decision, reflect only that observed
state. A resolved report requires the released version that contains the fix:

```bash
npx --no-install yls feedback update --report REPORT_ID --status resolved --fixed-in VERSION --json
```

Offer to update the project-local YLS version only after the version exists in
the configured public registry. After separate approval, update it exactly and
repeat the original operation or audit before claiming the loop is closed.

Security reports, suspected credential exposure, and exploit details must not
use a public feedback issue. Stop and route them through the repository's
private vulnerability-reporting surface.

The legacy `feedback export` command writes a selected local JSON file and does
not create a submission receipt. Use it only when the human explicitly asks
for a local export to a named destination.

To improve YLS across reviewed project exports, aggregate only an explicitly
selected inbox:

```bash
npx --no-install yls feedback aggregate --input REVIEWED_INBOX --output RULE_HEALTH.json --json
```

Treat the result as evidence for rule-development issues. Never let aggregation
silently suppress or rewrite an audit rule.
