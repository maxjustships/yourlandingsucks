import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { loadRun } from "./artifacts.js";
import { recordFeedback } from "./feedback.js";
import type {
  Finding,
  IssueStatus,
  IssueStore,
  IssueWorkPacket,
  LocalIssue,
  YlsConfig,
} from "./types.js";
import { ensureDirectory, stableHash, writeJsonAtomic } from "./utils.js";
import { verifyPreview } from "./verify.js";

function storePath(config: YlsConfig, cwd: string): string {
  return resolve(cwd, config.artifacts.directory, "issues.json");
}

function markdownPath(config: YlsConfig, cwd: string, issueId: string): string {
  return resolve(cwd, config.artifacts.directory, "issues", `${issueId}.md`);
}

function now(): string {
  return new Date().toISOString();
}

function autonomyFor(finding: Finding): IssueWorkPacket["autonomy"] {
  if (finding.kind === "verified_defect") {
    return {
      mode: "autofix",
      mayEdit: true,
      instruction: "Implement the smallest evidence-backed fix, then verify a preview. Do not deploy.",
      requiresHumanApprovalFor: ["production deployment", "new external service or credential", "destructive data change"],
    };
  }
  if (finding.kind === "heuristic_risk") {
    return {
      mode: "preview_only",
      mayEdit: true,
      instruction: "A reversible preview change is allowed, but treat it as a hypothesis and never claim conversion lift.",
      requiresHumanApprovalFor: ["pricing or offer change", "new product claim", "brand repositioning", "production deployment"],
    };
  }
  return {
    mode: "investigate",
    mayEdit: false,
    instruction: "Investigate and propose a test. This evidence alone does not authorize a code or product change.",
    requiresHumanApprovalFor: ["code change", "experiment launch", "production deployment"],
  };
}

export async function loadIssueStore(config: YlsConfig, cwd = process.cwd()): Promise<IssueStore> {
  try {
    return JSON.parse(await readFile(storePath(config, cwd), "utf8")) as IssueStore;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { schemaVersion: 1, updatedAt: now(), issues: [] };
    }
    throw error;
  }
}

async function saveIssueStore(config: YlsConfig, cwd: string, store: IssueStore): Promise<void> {
  store.updatedAt = now();
  await writeJsonAtomic(storePath(config, cwd), store);
}

function renderIssue(issue: LocalIssue, finding: Finding): string {
  const history = issue.history.map((event) =>
    `- ${event.timestamp} — ${event.type} in \`${event.runId}\`${event.agent ? ` by \`${event.agent}\`` : ""}${event.reasonCode ? ` (${event.reasonCode})` : ""}`,
  );
  return `# ${finding.title}

- Issue: \`${issue.id}\`
- Status: \`${issue.status}\`
- Finding: \`${finding.id}\`
- Evidence strength: \`${finding.kind}\`
- Autonomous mode: \`${autonomyFor(finding).mode}\`
- Severity / confidence: \`${finding.severity}\` / \`${finding.confidence}\`
- Baseline run: \`${issue.baselineRunId}\`
- Affected pages: ${finding.affectedPages.map((path) => `\`${path}\``).join(", ")}
- Attempts: ${issue.attempts}
- Reopened: ${issue.reopenedCount}

${finding.summary}

## Suggested action

${finding.suggestedAction}

## Evidence

${finding.evidence.map((item) => `- \`${item.path}\` / \`${item.viewport}\`: ${item.summary}`).join("\n")}

## Verification contract

${finding.verification.map((item) => `- ${item}`).join("\n")}

## Agent guardrails

- ${autonomyFor(finding).instruction}
- Change one causal variable for this issue.
- Do not deploy production or submit forms.
- A heuristic is not a proven cause of conversion loss.
- Verify an explicit preview before marking the issue verified.
- If blocked or rejected, record a structured reason instead of silently skipping.

## History

${history.join("\n")}
`;
}

async function findingForIssue(config: YlsConfig, cwd: string, issue: LocalIssue): Promise<Finding> {
  const { run } = await loadRun(issue.baselineRunId, config, cwd);
  const finding = run.findings.find((item) => item.id === issue.findingId);
  if (!finding) throw new Error(`Finding ${issue.findingId} is missing from baseline ${issue.baselineRunId}`);
  return finding;
}

async function writeIssueMarkdown(config: YlsConfig, cwd: string, issue: LocalIssue): Promise<void> {
  const finding = await findingForIssue(config, cwd, issue);
  const path = markdownPath(config, cwd, issue.id);
  await ensureDirectory(dirname(path));
  await writeFile(path, renderIssue(issue, finding), "utf8");
}

function issueId(finding: Finding): string {
  return `issue-${stableHash(finding.fingerprint)}`;
}

function severityWeight(issue: LocalIssue): number {
  return { critical: 4, high: 3, medium: 2, low: 1 }[issue.severity];
}

function sortIssues(issues: LocalIssue[]): LocalIssue[] {
  return [...issues].sort((a, b) =>
    a.priorityRank - b.priorityRank ||
    severityWeight(b) - severityWeight(a) ||
    a.id.localeCompare(b.id),
  );
}

export async function syncIssues(options: {
  config: YlsConfig;
  runId: string;
  scope?: "priority" | "all";
  cwd?: string;
}): Promise<{ created: number; updated: number; reopened: number; issues: LocalIssue[] }> {
  const cwd = options.cwd ?? process.cwd();
  const { run } = await loadRun(options.runId, options.config, cwd);
  const store = await loadIssueStore(options.config, cwd);
  const selectedIds = options.scope === "all" ? new Set(run.findings.map((item) => item.id)) : new Set(run.priorityQueue);
  const selected = run.findings.filter((finding) => selectedIds.has(finding.id));
  let created = 0;
  let updated = 0;
  let reopened = 0;

  for (const [rank, finding] of selected.entries()) {
    const id = issueId(finding);
    const existing = store.issues.find((issue) => issue.id === id);
    if (!existing) {
      const timestamp = now();
      store.issues.push({
        schemaVersion: 1,
        id,
        fingerprint: finding.fingerprint,
        findingId: finding.id,
        baselineRunId: run.runId,
        firstSeenRunId: run.runId,
        lastSeenRunId: run.runId,
        rule: finding.rule,
        title: finding.title,
        kind: finding.kind,
        severity: finding.severity,
        confidence: finding.confidence,
        affectedPageCount: finding.affectedPages.length,
        priorityRank: rank,
        status: "open",
        attempts: 0,
        reopenedCount: 0,
        history: [{ timestamp, type: "created", runId: run.runId }],
      });
      created += 1;
      continue;
    }

    if (existing.lastSeenRunId === run.runId) continue;

    const recursAfterVerification = existing.status === "verified" && existing.lastSeenRunId !== run.runId;
    existing.lastSeenRunId = run.runId;
    existing.findingId = finding.id;
    existing.rule = finding.rule;
    existing.title = finding.title;
    existing.kind = finding.kind;
    existing.severity = finding.severity;
    existing.confidence = finding.confidence;
    existing.affectedPageCount = finding.affectedPages.length;
    existing.priorityRank = rank;
    if (existing.status !== "claimed") existing.baselineRunId = run.runId;
    existing.history.push({ timestamp: now(), type: "synced", runId: run.runId });
    if (recursAfterVerification) {
      existing.status = "open";
      existing.reopenedCount += 1;
      delete existing.verifiedAt;
      existing.history.push({ timestamp: now(), type: "reopened", runId: run.runId, reasonCode: "finding_recurred" });
      reopened += 1;
      await recordFeedback({
        config: options.config,
        runId: run.runId,
        findingId: finding.id,
        decision: "reopened",
        reasonCode: "finding_recurred",
        cwd,
      });
    }
    updated += 1;
  }

  store.issues = sortIssues(store.issues);
  await saveIssueStore(options.config, cwd, store);
  for (const finding of selected) {
    const issue = store.issues.find((item) => item.id === issueId(finding))!;
    await writeIssueMarkdown(options.config, cwd, issue);
  }
  return { created, updated, reopened, issues: store.issues };
}

export async function getIssue(options: {
  config: YlsConfig;
  issueId: string;
  cwd?: string;
}): Promise<IssueWorkPacket> {
  const cwd = options.cwd ?? process.cwd();
  const store = await loadIssueStore(options.config, cwd);
  const issue = store.issues.find((item) => item.id === options.issueId);
  if (!issue) throw new Error(`Unknown issue: ${options.issueId}`);
  const finding = await findingForIssue(options.config, cwd, issue);
  return {
    issue,
    finding,
    autonomy: autonomyFor(finding),
    commands: {
      verify: `yls issue verify --id ${issue.id} --preview <preview-url>`,
      block: `yls issue update --id ${issue.id} --status blocked --reason-code agent_blocked`,
      reject: `yls issue update --id ${issue.id} --status rejected --reason-code not_actionable`,
      release: `yls issue update --id ${issue.id} --status open --reason-code agent_released`,
    },
  };
}

export async function nextIssue(options: {
  config: YlsConfig;
  agent: string;
  peek?: boolean;
  cwd?: string;
}): Promise<IssueWorkPacket | null> {
  const cwd = options.cwd ?? process.cwd();
  const store = await loadIssueStore(options.config, cwd);
  let issue = store.issues.find((item) => item.status === "claimed" && item.claimedBy === options.agent);
  if (!issue) issue = sortIssues(store.issues.filter((item) => item.status === "open"))[0];
  if (!issue) return null;

  if (!options.peek && issue.status === "open") {
    issue.status = "claimed";
    issue.claimedBy = options.agent;
    issue.claimedAt = now();
    issue.history.push({ timestamp: now(), type: "claimed", runId: issue.baselineRunId, agent: options.agent });
    await saveIssueStore(options.config, cwd, store);
    await recordFeedback({
      config: options.config,
      runId: issue.baselineRunId,
      findingId: issue.findingId,
      decision: "claimed",
      reasonCode: "agent_claimed",
      agent: options.agent,
      cwd,
    });
    await writeIssueMarkdown(options.config, cwd, issue);
  }
  return getIssue({ config: options.config, issueId: issue.id, cwd });
}

const mutableStatuses = new Set<IssueStatus>(["open", "blocked", "rejected"]);

export async function updateIssue(options: {
  config: YlsConfig;
  issueId: string;
  status: string;
  reasonCode?: string;
  note?: string;
  agent?: string;
  cwd?: string;
}): Promise<IssueWorkPacket> {
  const cwd = options.cwd ?? process.cwd();
  if (!mutableStatuses.has(options.status as IssueStatus)) {
    throw new Error("issue update status must be open, blocked, or rejected");
  }
  const store = await loadIssueStore(options.config, cwd);
  const issue = store.issues.find((item) => item.id === options.issueId);
  if (!issue) throw new Error(`Unknown issue: ${options.issueId}`);
  const status = options.status as IssueStatus;
  if ((status === "blocked" || status === "rejected") && !options.reasonCode) {
    throw new Error(`--reason-code is required when issue status is ${status}`);
  }
  issue.status = status;
  if (status !== "claimed") {
    delete issue.claimedAt;
    delete issue.claimedBy;
  }
  const type = status === "open" ? "released" : status === "blocked" ? "blocked" : "rejected";
  const decision = status === "open" ? "released" : status === "blocked" ? "blocked" : "rejected";
  issue.history.push({
    timestamp: now(),
    type,
    runId: issue.baselineRunId,
    ...(options.agent ? { agent: options.agent } : {}),
    ...(options.reasonCode ? { reasonCode: options.reasonCode } : {}),
  });
  await saveIssueStore(options.config, cwd, store);
  await recordFeedback({
    config: options.config,
    runId: issue.baselineRunId,
    findingId: issue.findingId,
    decision,
    ...(options.reasonCode ? { reasonCode: options.reasonCode } : {}),
    ...(options.note ? { note: options.note } : {}),
    ...(options.agent ? { agent: options.agent } : {}),
    cwd,
  });
  await writeIssueMarkdown(options.config, cwd, issue);
  return getIssue({ config: options.config, issueId: issue.id, cwd });
}

export async function verifyIssue(options: {
  config: YlsConfig;
  configPath: string;
  issueId: string;
  previewUrl: string;
  agent?: string;
  cwd?: string;
}): Promise<{ issue: LocalIssue; result: Awaited<ReturnType<typeof verifyPreview>> }> {
  const cwd = options.cwd ?? process.cwd();
  const store = await loadIssueStore(options.config, cwd);
  const issue = store.issues.find((item) => item.id === options.issueId);
  if (!issue) throw new Error(`Unknown issue: ${options.issueId}`);
  if (issue.status !== "claimed" && issue.status !== "open") {
    throw new Error(`Issue ${issue.id} cannot be verified from status ${issue.status}`);
  }
  const result = await verifyPreview({
    config: options.config,
    configPath: options.configPath,
    baselineRunId: issue.baselineRunId,
    previewUrl: options.previewUrl,
    requiredFindingId: issue.findingId,
    cwd,
  });
  issue.attempts += 1;
  issue.lastVerificationRunId = result.runId;
  delete issue.claimedAt;
  delete issue.claimedBy;
  if (result.verification.status === "passed") {
    issue.status = "verified";
    issue.verifiedAt = now();
    issue.history.push({
      timestamp: now(),
      type: "verified",
      runId: issue.baselineRunId,
      verificationRunId: result.runId,
      ...(options.agent ? { agent: options.agent } : {}),
    });
    await recordFeedback({
      config: options.config,
      runId: issue.baselineRunId,
      findingId: issue.findingId,
      decision: "verification_passed",
      reasonCode: "accepted",
      ...(options.agent ? { agent: options.agent } : {}),
      cwd,
    });
  } else {
    issue.status = "open";
    issue.history.push({
      timestamp: now(),
      type: "verification_failed",
      runId: issue.baselineRunId,
      verificationRunId: result.runId,
      reasonCode: "verification_failed",
      ...(options.agent ? { agent: options.agent } : {}),
    });
    await recordFeedback({
      config: options.config,
      runId: issue.baselineRunId,
      findingId: issue.findingId,
      decision: "verification_failed",
      reasonCode: "verification_failed",
      ...(options.agent ? { agent: options.agent } : {}),
      cwd,
    });
  }
  await saveIssueStore(options.config, cwd, store);
  await writeIssueMarkdown(options.config, cwd, issue);
  return { issue, result };
}
