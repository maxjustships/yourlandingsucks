# Audit, issue, and verification workflow

Use this workflow for an immediate audit or when YLS has returned local issues.

## Run an explicit audit

Select a confirmed site when the workspace contains more than one:

```bash
npx --no-install yls doctor --site SITE_ID --json
npx --no-install yls run --site SITE_ID --json
```

Read the JSON result and the generated `evidence.json` and `brief.md`. Preserve
the distinction between deterministic defects, heuristic risks, behavior
signals, and experiment results. Do not present the traffic mode as proof of
statistical power.

## Work the local issue queue

Synchronize a chosen run and claim one item:

```bash
npx --no-install yls issue sync --site SITE_ID --run RUN_ID --json
npx --no-install yls issue next --site SITE_ID --agent AGENT_NAME --json
```

Follow the returned autonomy policy. Make one causal, reversible change at a
time. Run focused project checks before broader checks. Do not mix unrelated
cleanup into the issue.

Use `blocked` with a concrete reason when the issue cannot proceed. Use
`rejected` or false-positive feedback only when evidence supports that decision;
do not suppress an inconvenient finding.

## Verify on a non-production preview

Start or obtain a preview using the project's existing safe workflow. Starting
paid infrastructure, deploying, pushing, or changing external configuration
requires the user's separate authorization.

Verify the claimed issue:

```bash
npx --no-install yls issue verify --site SITE_ID --id ISSUE_ID --preview PREVIEW_ORIGIN --agent AGENT_NAME --json
```

Only a passing preview verification closes an issue. Failed verification
returns it to `open`. If the same finding later recurs, YLS reopens the stable
issue instead of creating a duplicate.

Stop after at most three handled issues in one agent run. Report completed,
failed, skipped, blocked, and decision-needed work grouped by site.
