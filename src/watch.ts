import { dirname, resolve } from "node:path";
import { executeAuditRun, loadRun } from "./artifacts.js";
import { cronMatches, scheduledMinuteKey } from "./cron.js";
import { syncIssues } from "./issues.js";
import type { PageEvidence, RunArtifact, WatchDelta, WatchPacket, WatchState, YlsConfig } from "./types.js";
import { readJson, writeJsonAtomic } from "./utils.js";
import { loadWorkspace, loadWorkspaceSite } from "./workspace.js";

function now(): string {
  return new Date().toISOString();
}

function watchStatePath(workspacePath: string): string {
  return resolve(dirname(workspacePath), ".yls", "watch-state.json");
}

async function loadWatchState(workspacePath: string): Promise<WatchState> {
  try {
    return await readJson<WatchState>(watchStatePath(workspacePath));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { schemaVersion: 1, updatedAt: now(), sites: {} };
    }
    throw error;
  }
}

async function saveWatchState(workspacePath: string, state: WatchState): Promise<void> {
  state.updatedAt = now();
  await writeJsonAtomic(watchStatePath(workspacePath), state);
}

function uniquePaths(run: RunArtifact): string[] {
  return [...new Set(run.pages.map((page) => page.path))].sort();
}

function representativePages(run: RunArtifact): Map<string, PageEvidence> {
  const pages = new Map<string, PageEvidence>();
  for (const page of run.pages) if (!pages.has(page.path)) pages.set(page.path, page);
  return pages;
}

function changes(
  before: Map<string, PageEvidence>,
  after: Map<string, PageEvidence>,
  selector: (page: PageEvidence) => string,
): Array<{ path: string; before?: string; after?: string }> {
  const result: Array<{ path: string; before?: string; after?: string }> = [];
  for (const path of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const previous = before.get(path);
    const current = after.get(path);
    if (!previous || !current) continue;
    const previousValue = selector(previous);
    const currentValue = selector(current);
    if (previousValue !== currentValue) result.push({ path, before: previousValue, after: currentValue });
  }
  return result;
}

export function compareWatchRuns(previous: RunArtifact | undefined, current: RunArtifact): WatchDelta {
  if (!previous) {
    return {
      baseline: true,
      addedPaths: uniquePaths(current),
      removedPaths: [],
      addedFindingRules: [...new Set(current.findings.map((finding) => finding.rule))].sort(),
      resolvedFindingRules: [],
      titleChanges: [],
      h1Changes: [],
      statusChanges: [],
    };
  }
  const beforePaths = new Set(uniquePaths(previous));
  const afterPaths = new Set(uniquePaths(current));
  const beforeRules = new Set(previous.findings.map((finding) => finding.rule));
  const afterRules = new Set(current.findings.map((finding) => finding.rule));
  const beforePages = representativePages(previous);
  const afterPages = representativePages(current);
  const statusChanges: WatchDelta["statusChanges"] = [];
  for (const path of [...new Set([...beforePages.keys(), ...afterPages.keys()])].sort()) {
    const before = beforePages.get(path);
    const after = afterPages.get(path);
    if (before && after && before.status !== after.status) statusChanges.push({ path, before: before.status, after: after.status });
  }
  return {
    baseline: false,
    previousRunId: previous.runId,
    addedPaths: [...afterPaths].filter((path) => !beforePaths.has(path)),
    removedPaths: [...beforePaths].filter((path) => !afterPaths.has(path)),
    addedFindingRules: [...afterRules].filter((rule) => !beforeRules.has(rule)).sort(),
    resolvedFindingRules: [...beforeRules].filter((rule) => !afterRules.has(rule)).sort(),
    titleChanges: changes(beforePages, afterPages, (page) => page.title),
    h1Changes: changes(beforePages, afterPages, (page) => page.h1.join(" | ")),
    statusChanges,
  };
}

async function previousRun(config: YlsConfig, runId: string | undefined, cwd: string): Promise<RunArtifact | undefined> {
  if (!runId) return undefined;
  try {
    return (await loadRun(runId, config, cwd)).run;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function agentInstruction(siteId: string): string {
  return `Evaluate this watch packet for ${siteId} using the supplied natural-language rules. Observe-only rules may only be reported. Propose rules may produce a reversible proposal. Autonomous code changes are limited to verified defects and still require preview verification; never deploy production.`;
}

async function executeSiteWatch(options: {
  siteId: string;
  workspacePath: string;
  at: Date;
  state: WatchState;
  cwd: string;
}): Promise<WatchPacket> {
  const selected = await loadWorkspaceSite({ siteId: options.siteId, workspacePath: options.workspacePath, cwd: options.cwd });
  const watch = selected.config.watch;
  if (!watch) throw new Error(`site ${options.siteId} has no watch policy`);
  const siteState = options.state.sites[options.siteId] ?? {};
  const before = await previousRun(selected.config, siteState.lastRunId, dirname(selected.workspacePath));
  const result = await executeAuditRun({
    config: selected.config,
    configPath: selected.configPath,
    cwd: dirname(selected.workspacePath),
  });
  const issues = await syncIssues({
    config: selected.config,
    runId: result.run.runId,
    scope: "priority",
    cwd: dirname(selected.workspacePath),
  });
  const open = issues.issues.filter((issue) => issue.status === "open").length;
  return {
    siteId: options.siteId,
    status: "completed",
    runId: result.run.runId,
    runDirectory: result.runDirectory,
    schedule: watch.schedule,
    rules: watch.rules,
    delta: compareWatchRuns(before, result.run),
    issues: { created: issues.created, updated: issues.updated, reopened: issues.reopened, open },
    agentInstruction: agentInstruction(options.siteId),
    nextCommand: `yls issue next --site ${options.siteId} --workspace ${JSON.stringify(selected.workspacePath)} --agent <agent-name> --json`,
  };
}

export async function runWatch(options: {
  mode: "tick" | "run";
  siteId?: string;
  workspacePath?: string;
  at?: string;
  cwd?: string;
}): Promise<{
  status: "completed" | "partial_failure";
  at: string;
  packets: WatchPacket[];
  skipped: Array<{ siteId: string; reason: "watch_disabled" | "not_due" | "already_ran" }>;
  failures: Array<{ siteId: string; error: string }>;
}> {
  const cwd = options.cwd ?? process.cwd();
  const at = options.at ? new Date(options.at) : new Date();
  if (Number.isNaN(at.getTime())) throw new Error("--at must be a valid ISO timestamp");
  const loadedWorkspace = await loadWorkspace(options.workspacePath, cwd);
  const selectedSites = options.siteId
    ? loadedWorkspace.workspace.sites.filter((site) => site.id === options.siteId)
    : loadedWorkspace.workspace.sites;
  if (options.siteId && selectedSites.length === 0) throw new Error(`unknown or unconfirmed site: ${options.siteId}`);
  if (options.mode === "run" && !options.siteId) throw new Error("watch run requires --site");
  const state = await loadWatchState(loadedWorkspace.path);
  const packets: WatchPacket[] = [];
  const skipped: Array<{ siteId: string; reason: "watch_disabled" | "not_due" | "already_ran" }> = [];
  const failures: Array<{ siteId: string; error: string }> = [];

  for (const site of selectedSites) {
    const siteState = state.sites[site.id] ?? {};
    state.sites[site.id] = siteState;
    try {
      const selected = await loadWorkspaceSite({ siteId: site.id, workspacePath: loadedWorkspace.path, cwd });
      const watch = selected.config.watch;
      if (!watch?.enabled) {
        skipped.push({ siteId: site.id, reason: "watch_disabled" });
        continue;
      }
      const minuteKey = scheduledMinuteKey(at, watch.schedule.timezone);
      const matches = cronMatches(watch.schedule.cron, at, watch.schedule.timezone);
      if (options.mode === "tick" && !matches) {
        skipped.push({ siteId: site.id, reason: "not_due" });
        continue;
      }
      if (options.mode === "tick" && siteState.lastScheduledMinute === minuteKey) {
        skipped.push({ siteId: site.id, reason: "already_ran" });
        continue;
      }
      siteState.lastAttemptAt = at.toISOString();
      if (matches) siteState.lastScheduledMinute = minuteKey;
      await saveWatchState(loadedWorkspace.path, state);
      const packet = await executeSiteWatch({
        siteId: site.id,
        workspacePath: loadedWorkspace.path,
        at,
        state,
        cwd,
      });
      packets.push(packet);
      siteState.lastRunId = packet.runId;
      siteState.lastRunAt = at.toISOString();
      siteState.lastStatus = "completed";
      delete siteState.lastError;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      siteState.lastAttemptAt = at.toISOString();
      siteState.lastStatus = "failed";
      siteState.lastError = message;
      failures.push({ siteId: site.id, error: message });
    }
    await saveWatchState(loadedWorkspace.path, state);
  }
  return {
    status: failures.length > 0 ? "partial_failure" : "completed",
    at: at.toISOString(),
    packets,
    skipped,
    failures,
  };
}
