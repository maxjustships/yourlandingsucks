# Security and trust model

YLS is local-first, but local execution is not automatically safe. A malicious
CLI or MCP server can inherit the privileges of the process that launches it.
Review and pin releases, and use an OS/container sandbox when the repository or
analytics data is sensitive.

## V0 capability boundary

YLS is designed to require:

- outbound HTTP(S) to the configured target origin and public subresources the
  rendered page references;
- outbound HTTP(S) to the explicitly configured analytics host, if any;
- read access to the selected `yls.yaml`;
- read access to an explicitly configured local analytics snapshot, if any;
- write access to the configured relative artifact directory;
- explicit write access to `yls.workspace.yaml` and `yls-sites/` during
  human-confirmed site onboarding;
- explicit write access to `.agents/skills/yourlandingsucks/` and a bounded
  YourLandingSucks block in the repository's `AGENTS.md` when agent integration
  is installed;
- an explicit write destination for `feedback export`.
- read access to an explicitly selected sanitized export file or directory for
  `feedback aggregate`.

It does not need repository traversal, Git credentials, deployment credentials,
an LLM API key, or a remotely hosted YLS account.

`site confirm` hashes the validated site config. Later config drift blocks the
site until replacement onboarding is confirmed. This is an auditable workflow
gate, not proof of human identity; the surrounding coding agent remains the
authorization boundary.

## Recommended sandbox

For sensitive projects, run YLS with:

- the source repository unmounted or mounted read-only;
- only `yls.yaml` and `.yls/` writable/visible where practical;
- network egress limited to the target origin, explicitly required page asset
  hosts, and the analytics host;
- a dedicated read-only analytics credential;
- a pinned package version and lockfile;
- no production form-submission permission.

The CLI is the primary integration contract and must not become a privileged
proxy for arbitrary shell commands.

Agent integration preserves instructions outside its marked block and refuses
to replace an unmanaged skill directory, follow a symbolic link, or repair
incomplete/duplicate markers. Review the generated block like any other
repository-level agent instruction.

## Data handling

Raw runs may contain public page copy, URLs, runtime messages, selectors, and
screenshots. `.yls/` is ignored by default. Do not commit or upload it without
review.

The installed Agent Skill contains only packaged instructions and metadata. It
does not copy repository source, secrets, credentials, or raw audit artifacts.

Feedback export is opt-in and intentionally lossy. Free-form notes remain only
in the local ledger. Aggregation is also explicit and offline; point it only at
a dedicated inbox of reviewed sanitized exports.

Natural-language watch rules, onboarding assumptions, and human answers may
contain product-sensitive context. Proposal/answer records and watch state stay
under ignored `.yls/`; confirmed site configs and `yls.workspace.yaml` are
intended to be reviewed and committed. A scheduled agent should receive only
the repository permissions and external-action authority it actually needs.
External scheduler provider names, automation IDs, registration timestamps, and
heartbeats also remain in ignored local watch state. They are evidence supplied
by the surrounding agent, not independent proof from the scheduler provider.

## Supported versions

This project is prerelease software. Security fixes are made against the latest
published alpha only; see [SUPPORT.md](SUPPORT.md). Runtime dependencies are
pinned exactly so browser and accessibility evidence cannot silently change
between installs.

## Reporting vulnerabilities

Do not open a public issue containing credentials or exploitable details. Use
[GitHub private vulnerability reporting](https://github.com/maxjustships/yourlandingsucks/security/advisories/new)
and include a minimal reproduction with secrets removed. If that form is
unavailable, do not disclose the report publicly; contact the repository owner
through their GitHub profile and request a private channel.
