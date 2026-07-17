import { dirname, resolve } from "node:path";
import { executeAuditRun, loadRun } from "./artifacts.js";
import { cronMatches, scheduledMinuteKey } from "./cron.js";
import { syncIssues } from "./issues.js";
import type {
  PageEvidence,
  RunArtifact,
  WatchDelta,
  WatchPacket,
  WatchPlanSite,
  WatchRegistration,
  WatchSiteState,
  WatchState,
  WatchStatusSite,
  YlsConfig,
} from "./types.js";
import { readJson, stableHash, writeJsonAtomic } from "./utils.js";
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

function scheduleFingerprint(schedule: { naturalLanguage: string; cron: string; timezone: string }): string {
  return stableHash(JSON.stringify(schedule), 32);
}

function selectedWorkspaceSites<T extends { id: string }>(sites: T[], siteId?: string): T[] {
  const selected = siteId ? sites.filter((site) => site.id === siteId) : sites;
  if (siteId && selected.length === 0) throw new Error(`unknown or unconfirmed site: ${siteId}`);
  return selected;
}

function validateRegistrationInput(provider: string, externalId: string, maxSilenceMinutes: number): void {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(provider)) {
    throw new Error("--provider must be a lowercase identifier using letters, numbers, underscores, or hyphens");
  }
  if (!externalId.trim() || externalId.length > 200 || /[\r\n\0]/.test(externalId)) {
    throw new Error("--external-id must be a non-empty external automation identifier under 201 characters");
  }
  if (!Number.isInteger(maxSilenceMinutes) || maxSilenceMinutes < 1 || maxSilenceMinutes > 525_600) {
    throw new Error("--max-silence-minutes must be an integer between 1 and 525600");
  }
}

function healthForSite(state: WatchSiteState, registration: WatchRegistration | undefined, fingerprint: string, at: Date): {
  health: WatchStatusSite["health"];
  heartbeatAgeMinutes?: number;
} {
  if (!registration) return { health: "not_registered" };
  if (registration.scheduleFingerprint !== fingerprint) return { health: "schedule_changed" };
  const lastAttempt = state.lastAttemptAt ? new Date(state.lastAttemptAt).getTime() : Number.NEGATIVE_INFINITY;
  const lastRun = state.lastRunAt ? new Date(state.lastRunAt).getTime() : Number.NEGATIVE_INFINITY;
  if (state.lastStatus === "failed" && lastAttempt >= lastRun) return { health: "failed" };
  if (!state.lastRunAt || lastRun < new Date(registration.registeredAt).getTime()) return { health: "pending_first_run" };
  const heartbeatAgeMinutes = Math.max(0, Math.floor((at.getTime() - lastRun) / 60_000));
  return {
    health: heartbeatAgeMinutes > registration.maxSilenceMinutes ? "stale" : "healthy",
    heartbeatAgeMinutes,
  };
}

export async function planWatch(options: { siteId?: string; workspacePath?: string; cwd?: string } = {}): Promise<{
  schemaVersion: 1;
  status: "activation_required" | "registered";
  generatedAt: string;
  workspacePath: string;
  sites: WatchPlanSite[];
}> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const loaded = await loadWorkspace(options.workspacePath, cwd);
  const state = await loadWatchState(loaded.path);
  const sites: WatchPlanSite[] = [];
  for (const site of selectedWorkspaceSites(loaded.workspace.sites, options.siteId)) {
    const selected = await loadWorkspaceSite({ siteId: site.id, workspacePath: loaded.path, cwd });
    const watch = selected.config.watch;
    if (!watch?.enabled) continue;
    const fingerprint = scheduleFingerprint(watch.schedule);
    sites.push({
      siteId: site.id,
      origin: selected.config.site.url,
      schedule: watch.schedule,
      rules: watch.rules,
      scheduleFingerprint: fingerprint,
      registrationCurrent: state.sites[site.id]?.registration?.scheduleFingerprint === fingerprint,
      invocation: {
        command: "npx",
        args: ["--no-install", "yls", "watch", "run", "--site", site.id, "--workspace", loaded.path, "--json"],
        cwd: dirname(loaded.path),
      },
    });
  }
  if (sites.length === 0) throw new Error("no confirmed sites have watch enabled");
  return {
    schemaVersion: 1,
    status: sites.every((site) => site.registrationCurrent) ? "registered" : "activation_required",
    generatedAt: now(),
    workspacePath: loaded.path,
    sites,
  };
}

export async function registerWatch(options: {
  siteId: string;
  provider: string;
  externalId: string;
  maxSilenceMinutes: number;
  workspacePath?: string;
  cwd?: string;
}): Promise<{ status: "registered"; siteId: string; registration: WatchRegistration }> {
  validateRegistrationInput(options.provider, options.externalId, options.maxSilenceMinutes);
  const cwd = resolve(options.cwd ?? process.cwd());
  const loaded = await loadWorkspace(options.workspacePath, cwd);
  const selected = await loadWorkspaceSite({ siteId: options.siteId, workspacePath: loaded.path, cwd });
  const watch = selected.config.watch;
  if (!watch?.enabled) throw new Error(`site ${options.siteId} does not have watch enabled`);
  const registration: WatchRegistration = {
    provider: options.provider,
    externalId: options.externalId,
    registeredAt: now(),
    maxSilenceMinutes: options.maxSilenceMinutes,
    scheduleFingerprint: scheduleFingerprint(watch.schedule),
  };
  const state = await loadWatchState(loaded.path);
  state.sites[options.siteId] = { ...state.sites[options.siteId], registration };
  await saveWatchState(loaded.path, state);
  return { status: "registered", siteId: options.siteId, registration };
}

export async function unregisterWatch(options: { siteId: string; workspacePath?: string; cwd?: string }): Promise<{
  status: "unregistered";
  siteId: string;
  removed: boolean;
}> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const loaded = await loadWorkspace(options.workspacePath, cwd);
  await loadWorkspaceSite({ siteId: options.siteId, workspacePath: loaded.path, cwd });
  const state = await loadWatchState(loaded.path);
  const removed = Boolean(state.sites[options.siteId]?.registration);
  if (state.sites[options.siteId]) delete state.sites[options.siteId]!.registration;
  await saveWatchState(loaded.path, state);
  return { status: "unregistered", siteId: options.siteId, removed };
}

export async function watchStatus(options: { siteId?: string; workspacePath?: string; at?: string; cwd?: string } = {}): Promise<{
  schemaVersion: 1;
  status: "healthy" | "attention_required";
  at: string;
  workspacePath: string;
  sites: WatchStatusSite[];
}> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const at = options.at ? new Date(options.at) : new Date();
  if (Number.isNaN(at.getTime())) throw new Error("--at must be a valid ISO timestamp");
  const loaded = await loadWorkspace(options.workspacePath, cwd);
  const state = await loadWatchState(loaded.path);
  const sites: WatchStatusSite[] = [];
  for (const site of selectedWorkspaceSites(loaded.workspace.sites, options.siteId)) {
    const selected = await loadWorkspaceSite({ siteId: site.id, workspacePath: loaded.path, cwd });
    const watch = selected.config.watch;
    if (!watch) continue;
    const siteState = state.sites[site.id] ?? {};
    const fingerprint = scheduleFingerprint(watch.schedule);
    const health = watch.enabled
      ? healthForSite(siteState, siteState.registration, fingerprint, at)
      : { health: "disabled" as const };
    sites.push({
      siteId: site.id,
      origin: selected.config.site.url,
      health: health.health,
      schedule: watch.schedule,
      scheduleFingerprint: fingerprint,
      ...(siteState.registration ? { registration: siteState.registration } : {}),
      ...(siteState.lastRunId ? { lastRunId: siteState.lastRunId } : {}),
      ...(siteState.lastRunAt ? { lastRunAt: siteState.lastRunAt } : {}),
      ...(siteState.lastAttemptAt ? { lastAttemptAt: siteState.lastAttemptAt } : {}),
      ...(siteState.lastStatus ? { lastStatus: siteState.lastStatus } : {}),
      ...(siteState.lastError ? { lastError: siteState.lastError } : {}),
      ...(health.heartbeatAgeMinutes !== undefined ? { heartbeatAgeMinutes: health.heartbeatAgeMinutes } : {}),
    });
  }
  return {
    schemaVersion: 1,
    status: sites.every((site) => site.health === "healthy" || site.health === "disabled") ? "healthy" : "attention_required",
    at: at.toISOString(),
    workspacePath: loaded.path,
    sites,
  };
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
  const selectedSites = selectedWorkspaceSites(loadedWorkspace.workspace.sites, options.siteId);
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
