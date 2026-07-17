import { appendFile, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { loadRun } from "./artifacts.js";
import type {
  FeedbackDecision,
  FeedbackAggregate,
  FeedbackAggregateRule,
  FeedbackEvent,
  YlsConfig,
} from "./types.js";
import { ensureDirectory, packageVersion } from "./utils.js";

const decisions = new Set<FeedbackDecision>([
  "claimed",
  "released",
  "blocked",
  "reopened",
  "accepted",
  "rejected",
  "false_positive",
  "applied",
  "verification_passed",
  "verification_failed",
  "won",
  "lost",
  "inconclusive",
  "rolled_back",
]);

const reasonCodes = new Set([
  "accepted",
  "not_actionable",
  "false_positive",
  "duplicate",
  "already_fixed",
  "agent_failed",
  "verification_failed",
  "experiment_won",
  "experiment_lost",
  "experiment_inconclusive",
  "rollback",
  "agent_claimed",
  "agent_released",
  "agent_blocked",
  "finding_recurred",
  "review.accepted",
  "review.rejected",
  "other",
]);

export function validateDecision(value: string): FeedbackDecision {
  if (!decisions.has(value as FeedbackDecision)) {
    throw new Error(`Unsupported feedback decision: ${value}`);
  }
  return value as FeedbackDecision;
}

function validateReasonCode(value?: string): string | undefined {
  if (!value) return undefined;
  if (!reasonCodes.has(value)) {
    throw new Error(`Unsupported reason-code: ${value}`);
  }
  return value;
}

export async function recordFeedback(options: {
  config: YlsConfig;
  runId: string;
  findingId: string;
  decision: string;
  reasonCode?: string;
  note?: string;
  agent?: string;
  cwd?: string;
}): Promise<FeedbackEvent> {
  const cwd = options.cwd ?? process.cwd();
  const { run } = await loadRun(options.runId, options.config, cwd);
  if (!run.findings.some((finding) => finding.id === options.findingId)) {
    throw new Error(`Finding ${options.findingId} does not exist in run ${options.runId}`);
  }
  const event: FeedbackEvent = {
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    runId: options.runId,
    findingId: options.findingId,
    decision: validateDecision(options.decision),
    ...(validateReasonCode(options.reasonCode) ? { reasonCode: options.reasonCode } : {}),
    ...(options.note ? { note: options.note } : {}),
    ...(options.agent ? { agent: options.agent } : {}),
  };
  const ledgerPath = resolve(cwd, options.config.artifacts.directory, "ledger.ndjson");
  await ensureDirectory(dirname(ledgerPath));
  await appendFile(ledgerPath, `${JSON.stringify(event)}\n`, "utf8");
  return event;
}

async function readLedger(path: string): Promise<FeedbackEvent[]> {
  try {
    const raw = await readFile(path, "utf8");
    return raw
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as FeedbackEvent);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function exportFeedback(options: {
  config: YlsConfig;
  runId: string;
  output: string;
  cwd?: string;
}): Promise<Record<string, unknown>> {
  const cwd = options.cwd ?? process.cwd();
  const { run } = await loadRun(options.runId, options.config, cwd);
  const ledgerPath = resolve(cwd, options.config.artifacts.directory, "ledger.ndjson");
  const events = (await readLedger(ledgerPath)).filter((event) => event.runId === options.runId);
  const exportedFindings = run.findings
    .filter((finding) => events.some((event) => event.findingId === finding.id))
    .map((finding) => ({
      id: finding.id,
      rule: finding.rule,
      kind: finding.kind,
      severity: finding.severity,
      confidence: finding.confidence,
      affectedPageCount: finding.affectedPages.length,
    }));
  const payload = {
    schemaVersion: 1,
    toolVersion: packageVersion(),
    runId: options.runId,
    trafficMode: run.traffic.mode,
    findings: exportedFindings,
    events: events.map((event) => ({
      timestamp: event.timestamp,
      findingId: event.findingId,
      decision: event.decision,
      ...(event.reasonCode ? { reasonCode: event.reasonCode } : {}),
    })),
  };
  const output = resolve(cwd, options.output);
  await ensureDirectory(dirname(output));
  await writeFile(output, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return payload;
}

interface SanitizedExport {
  schemaVersion: 1;
  runId: string;
  findings: Array<{ id: string; rule: string }>;
  events: Array<{ findingId: string; decision: FeedbackDecision; reasonCode?: string }>;
}

function isSanitizedExport(value: unknown): value is SanitizedExport {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SanitizedExport>;
  return candidate.schemaVersion === 1 && typeof candidate.runId === "string" &&
    Array.isArray(candidate.findings) && candidate.findings.every((finding) =>
      Boolean(finding) && typeof finding === "object" && typeof finding.id === "string" && typeof finding.rule === "string") &&
    Array.isArray(candidate.events) && candidate.events.every((event) =>
      Boolean(event) && typeof event === "object" && typeof event.findingId === "string" &&
      decisions.has(event.decision as FeedbackDecision) &&
      (event.reasonCode === undefined || typeof event.reasonCode === "string"));
}

async function feedbackInputFiles(input: string): Promise<string[]> {
  const info = await stat(input);
  if (info.isFile()) return [input];
  if (!info.isDirectory()) throw new Error("feedback aggregate input must be a JSON file or directory");
  return (await readdir(input, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === ".json")
    .map((entry) => join(input, entry.name))
    .sort();
}

export async function aggregateFeedback(options: {
  input: string;
  output?: string;
  cwd?: string;
}): Promise<FeedbackAggregate> {
  const cwd = options.cwd ?? process.cwd();
  const outputPath = options.output ? resolve(cwd, options.output) : undefined;
  const files = (await feedbackInputFiles(resolve(cwd, options.input))).filter((file) => resolve(file) !== outputPath);
  if (files.length === 0) throw new Error("feedback aggregate found no JSON files");
  const runIds = new Set<string>();
  let duplicateRunsSkipped = 0;
  const counters = new Map<string, {
    findingCount: number;
    eventCount: number;
    decisions: Partial<Record<FeedbackDecision, number>>;
    reasons: Record<string, number>;
    falsePositiveCount: number;
  }>();

  for (const file of files) {
    const payload = JSON.parse(await readFile(file, "utf8")) as unknown;
    if (!isSanitizedExport(payload)) throw new Error(`Invalid sanitized feedback export: ${file}`);
    if (runIds.has(payload.runId)) {
      duplicateRunsSkipped += 1;
      continue;
    }
    runIds.add(payload.runId);
    const ruleByFinding = new Map(payload.findings.map((finding) => [finding.id, finding.rule]));
    for (const finding of payload.findings) {
      const current = counters.get(finding.rule) ?? { findingCount: 0, eventCount: 0, decisions: {}, reasons: {}, falsePositiveCount: 0 };
      current.findingCount += 1;
      counters.set(finding.rule, current);
    }
    for (const event of payload.events) {
      const rule = ruleByFinding.get(event.findingId);
      if (!rule) throw new Error(`Feedback event references unknown finding ${event.findingId} in ${file}`);
      const current = counters.get(rule)!;
      current.eventCount += 1;
      current.decisions[event.decision] = (current.decisions[event.decision] ?? 0) + 1;
      if (event.reasonCode) current.reasons[event.reasonCode] = (current.reasons[event.reasonCode] ?? 0) + 1;
      if (event.decision === "false_positive" || event.reasonCode === "false_positive") current.falsePositiveCount += 1;
    }
  }

  const rules: FeedbackAggregateRule[] = [...counters.entries()].map(([rule, value]) => {
    const falsePositives = value.falsePositiveCount;
    const reviews = (value.decisions.accepted ?? 0) + (value.decisions.rejected ?? 0) + falsePositives;
    const verificationFailures = value.decisions.verification_failed ?? 0;
    const verificationAttempts = verificationFailures + (value.decisions.verification_passed ?? 0);
    const recurrenceCount = value.decisions.reopened ?? 0;
    const suggestedMetaAction: FeedbackAggregateRule["suggestedMetaAction"] = falsePositives > 0
      ? "tighten_detection"
      : verificationFailures > (value.decisions.verification_passed ?? 0)
        ? "improve_verification"
        : recurrenceCount > 0
          ? "add_regression_guard"
          : "keep_observing";
    return {
      rule,
      ...value,
      falsePositiveRate: reviews > 0 ? falsePositives / reviews : null,
      verificationFailureRate: verificationAttempts > 0 ? verificationFailures / verificationAttempts : null,
      recurrenceCount,
      suggestedMetaAction,
    };
  }).sort((a, b) =>
    Number(b.suggestedMetaAction !== "keep_observing") - Number(a.suggestedMetaAction !== "keep_observing") ||
    b.eventCount - a.eventCount || a.rule.localeCompare(b.rule),
  );

  const aggregate: FeedbackAggregate = {
    schemaVersion: 1,
    exportsRead: files.length,
    uniqueRuns: runIds.size,
    duplicateRunsSkipped,
    rules,
  };
  if (outputPath) {
    await ensureDirectory(dirname(outputPath));
    await writeFile(outputPath, `${JSON.stringify(aggregate, null, 2)}\n`, "utf8");
  }
  return aggregate;
}
