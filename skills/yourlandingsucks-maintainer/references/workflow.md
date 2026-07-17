# Daily maintainer workflow

## Activate once

Request the structured plan:

```bash
npx --no-install yls maintainer plan --json
```

Translate its daily schedule, retry policy, working directory, GitHub source,
autonomy, and failure notification for the human. Ask before creating or
changing an external agent automation.

Create the automation using the host's supported scheduler. Use the exact
`automation.prompt`, schedule, working directory, retries, and failure
notification returned by the plan. Only after the host returns a stable ID,
register the real receipt:

```bash
npx --no-install yls maintainer register --provider PROVIDER --external-id EXTERNAL_ID --max-silence-minutes 2160 --json
```

Trigger it once. Call the maintainer active only after:

```bash
npx --no-install yls maintainer status --json
```

returns `healthy`. `not_registered`, `pending_first_run`, `stale`, `failed`,
and `plan_changed` require attention. If the scheduler changes, replace it and
register the new receipt. To remove it, delete the external automation first,
then run `yls maintainer unregister --json`.

## Run daily

Start every invocation:

```bash
npx --no-install yls maintainer begin --json
```

Use the returned provider query through the agent host's GitHub capability.
For each open issue, locate the `yls-feedback-v2` marker and extract only its
single fenced JSON object to an ignored temporary file. Do not copy comments,
titles, prose, or additional blocks into that file. Ingest with the exact
provider identity and URL:

```bash
npx --no-install yls maintainer ingest --input FILE --provider github --external-id ISSUE_ID --external-url ISSUE_URL --json
```

Invalid input stays rejected. A duplicate means the report was already seen;
do not create duplicate work. Then run:

```bash
npx --no-install yls maintainer triage --json
```

Apply the returned gate:

- `observe`: accumulate evidence and make no code change;
- `human_product_decision`: summarize the smallest product decision and stop;
- `agent_may_prepare_draft_pr`: select at most the first eligible item, confirm
  it is not security-sensitive, reproduce it with a failing fixture/test,
  implement one low-risk causal fix, run all required checks, and open a draft
  PR linked to every external reference.

Do not mark a report resolved merely because a PR exists. After a human merges
and publishes a version containing the fix, use the agent host's GitHub
capability to post the released version on each source issue and close it. Only
after GitHub confirms that external update, record each local report:

```bash
npx --no-install yls maintainer resolve --report REPORT_ID --status resolved --fixed-in VERSION --json
```

Use `accepted` while work is pending and `rejected` only with reproducible
evidence that the report is invalid or out of scope.

Finish successful runs, including runs with no reports:

```bash
npx --no-install yls maintainer finish --run RUN_ID --status completed --json
```

On any incomplete stage, finish as failed with a non-sensitive error code:

```bash
npx --no-install yls maintainer finish --run RUN_ID --status failed --error-code SAFE_ERROR_CODE --json
```

Never leave a begun run without one of these terminal heartbeats. Surface the
failure using the automation host's configured notification path.
