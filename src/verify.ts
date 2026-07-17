import { resolve } from "node:path";
import { executeAuditRun, loadRun } from "./artifacts.js";
import type { Finding, VerificationArtifact, YlsConfig } from "./types.js";
import { writeJson } from "./utils.js";

function evidenceKeys(finding: Finding): Set<string> {
  return new Set(finding.evidence.map((item) => `${item.path}|${item.viewport}`));
}

function isGuardrailFinding(finding: Finding): boolean {
  if (finding.kind === "verified_defect") return true;
  return ["performance.", "layout.", "accessibility.", "forms.", "runtime.", "network.", "navigation."].some(
    (prefix) => finding.rule.startsWith(prefix),
  );
}

export async function verifyPreview(options: {
  config: YlsConfig;
  configPath: string;
  baselineRunId: string;
  previewUrl: string;
  requiredFindingId?: string;
  cwd?: string;
}): Promise<{
  verification: VerificationArtifact;
  runDirectory: string;
  runId: string;
}> {
  const cwd = options.cwd ?? process.cwd();
  const baseline = await loadRun(options.baselineRunId, options.config, cwd);
  if (options.requiredFindingId && !baseline.run.findings.some((finding) => finding.id === options.requiredFindingId)) {
    throw new Error(`Finding ${options.requiredFindingId} does not exist in baseline ${options.baselineRunId}`);
  }
  const paths = [...new Set(baseline.run.pages.map((page) => page.path))];
  const after = await executeAuditRun({
    config: options.config,
    configPath: options.configPath,
    cwd,
    command: "verify",
    siteUrlOverride: options.previewUrl,
    explicitPaths: paths,
  });

  const beforeById = new Map(baseline.run.findings.map((finding) => [finding.id, finding]));
  const afterById = new Map(after.run.findings.map((finding) => [finding.id, finding]));
  const resolvedFindingIds = baseline.run.findings
    .filter((finding) => !afterById.has(finding.id))
    .map((finding) => finding.id);
  const remainingFindingIds = baseline.run.findings
    .filter((finding) => afterById.has(finding.id))
    .map((finding) => finding.id);
  const regressions = new Set<string>();

  for (const finding of after.run.findings) {
    if (!isGuardrailFinding(finding)) continue;
    const before = beforeById.get(finding.id);
    if (!before) {
      regressions.add(finding.id);
      continue;
    }
    const beforeEvidence = evidenceKeys(before);
    if ([...evidenceKeys(finding)].some((key) => !beforeEvidence.has(key))) {
      regressions.add(finding.id);
    }
  }

  const requiredFindingResolved = options.requiredFindingId
    ? resolvedFindingIds.includes(options.requiredFindingId)
    : undefined;
  const status = regressions.size === 0 && requiredFindingResolved !== false ? "passed" : "failed";
  const verification: VerificationArtifact = {
    schemaVersion: 1,
    baselineRunId: options.baselineRunId,
    verificationRunId: after.run.runId,
    previewOrigin: new URL(options.previewUrl).origin,
    status,
    ...(options.requiredFindingId ? { requiredFindingId: options.requiredFindingId, requiredFindingResolved } : {}),
    resolvedFindingIds,
    remainingFindingIds,
    regressionFindingIds: [...regressions],
  };
  await writeJson(resolve(after.runDirectory, "verification.json"), verification);
  return { verification, runDirectory: after.runDirectory, runId: after.run.runId };
}
