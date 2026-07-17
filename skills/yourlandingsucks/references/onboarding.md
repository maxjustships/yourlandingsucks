# Onboarding workflow

Use this workflow for the first installation and whenever a project gains a new
public site.

## 1. Establish the project-local tool

Detect the repository's package manager and conventions. If YLS is not already
installed, install the source specified by the user or bootstrap prompt as a
development dependency. The default public prerelease is:

```text
yourlandingsucks@0.1.0-alpha.0
```

Confirm the local binary works:

```bash
npx --no-install yls help
```

Ensure the durable project capability is installed and current:

```bash
npx --no-install yls agent check --json
npx --no-install yls agent install --json
```

Run `agent install` when `agent check` is not current. It copies the bundled
skill into `.agents/skills/yourlandingsucks` and maintains a bounded block in
`AGENTS.md` so a fresh agent session can discover YLS. Do not describe these
files or commands to the human unless they ask how integration works.

Do not request a YLS account, model key, GitHub token, or deployment credential.

## 2. Discover every public site

Inspect the repository and deployment metadata before asking the human for
URLs. Useful evidence includes package scripts, hosting configuration, domain
configuration, environment-variable names without secret values, public docs,
and existing analytics configuration. Inspect candidate origins read-only.

Create a separate candidate for every distinct public product surface, such as
a marketing site, application shell, documentation site, status site, or
regional site when it has different rules. Do not collapse sites merely because
they live in one monorepo. Do not split one origin unless different ownership or
policies require it.

For every candidate infer:

- a stable lowercase site ID and canonical public origin;
- purpose, audience, and critical journeys;
- include and exclude masks;
- conversion, acquisition, documentation, and informational page roles;
- bounded crawl and browser settings;
- analytics mode and readiness thresholds;
- a natural-language watch schedule plus five-field cron and IANA timezone;
- natural-language watch rules and the narrowest safe autonomy level;
- assumptions, evidence, and unresolved human decisions.

Every site receives this description regardless of its traffic. Traffic only
controls whether evidence is classified as `ready`, `listen`, or `optimize`.

## 3. Draft each site

Run once per candidate:

```bash
npx --no-install yls site draft --id SITE_ID --url PUBLIC_ORIGIN --agent AGENT_NAME --json
```

Edit `yls-sites/SITE_ID.yaml` using the inferred evidence. Keep artifacts under
`.yls/sites/SITE_ID`. Keep production interaction read-only and preserve bounded
crawl settings.

Edit `.yls/onboarding/SITE_ID.draft.yaml` so it contains concrete assumptions,
assumed answers, and concise questions. Ask only about choices that cannot be
safely inferred. The final approval of the complete proposal is always a valid
required question; do not manufacture extra configuration questions.

Freeze the inactive proposal:

```bash
npx --no-install yls site propose --file .yls/onboarding/SITE_ID.draft.yaml --json
```

## 4. Present one human decision surface

Show all proposed sites in one response, grouped by site. For each include:

- origin, scope, purpose, audience, and critical journeys;
- page roles and exclusions;
- analytics mode and evidence mode;
- schedule, timezone, natural-language rules, and autonomy;
- assumptions and the evidence behind them;
- only the returned questions that still require a human decision.

State clearly that the proposal is inactive. Stop and wait. Do not run `site
confirm`, create answers, activate a scheduler, or silently accept assumed
answers.

## 5. Confirm actual answers

After the human responds, update the site config to match the decisions. Write
their answers verbatim or faithfully summarized into a local answers YAML for
the stored proposal ID. Every answer must be non-empty and the file must set
`humanConfirmed: true`.

Run:

```bash
npx --no-install yls site confirm --proposal STORED_PROPOSAL.json --answers HUMAN_ANSWERS.yaml --json
npx --no-install yls doctor --site SITE_ID --json
```

If the browser check returns `code: browser_unavailable`, translate its reason
for the human and ask permission before downloading a local browser. Only after
approval run the structured remediation command returned by `doctor`, then run
`doctor` again. Do not improvise a global installation or hide the download.

If `doctor` requires a config change, create a replacement proposal with
`site propose --replace`, explain the exact change, and obtain fresh human
confirmation. Never edit the config hash or workspace registry to bypass this
gate.

## 6. Capture the first baseline

For each healthy confirmed site run:

```bash
npx --no-install yls watch run --site SITE_ID --json
```

Report baseline run IDs, evidence mode, issue counts, and any site failures.
Then propose a scheduling mechanism appropriate to the repository or agent.
Do not activate it until the human explicitly chooses it.

## 7. Activate recurring monitoring only when requested

Read [watch-and-feedback.md](watch-and-feedback.md) and follow its activation
protocol. Site confirmation and a baseline are not scheduler activation. Never
call monitoring active until an external automation was actually created,
registered, executed once, and reported `healthy` by YLS.
