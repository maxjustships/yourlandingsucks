# Watch and feedback workflow

Use this workflow from an external scheduler or agent automation that already
has the intended repository permissions.

## Scheduled watch

Run:

```bash
npx --no-install yls watch tick --json
```

Do not edit confirmed site configs, `yls.workspace.yaml`, or watch state to make
a site due or bypass onboarding. Report every site failure and continue with
successful packets.

For each packet, evaluate only its current evidence, delta, and confirmed
natural-language rules:

- `observe`: report the matched condition; do not edit code;
- `propose`: prepare a reversible proposal and name the human decision needed;
- `autofix_verified_defects`: claim one deterministic defect, implement one
  causal change, run project checks, and preview-verify it using the issue
  workflow.

No watch policy authorizes deployment, push, DNS changes, pricing or claim
changes, paid resources, form submission, or secret exposure. Stop after three
handled issues across the entire tick.

YLS deduplicates each site's scheduled local minute, isolates failures, and
reports changes to routes, finding rules, titles, H1s, and HTTP status. Assume
one coordinating watch process unless the installed version states otherwise.

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
