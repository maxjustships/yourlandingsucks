import { access, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, normalize, relative, resolve, sep } from "node:path";
import { parse, stringify } from "yaml";
import { defaultConfig, loadConfig } from "./config.js";
import type {
  HumanOnboardingAnswers,
  OnboardingProposal,
  OnboardingProposalInput,
  WorkspaceConfig,
  WorkspaceSite,
  YlsConfig,
} from "./types.js";
import { ensureDirectory, pathInside, readJson, stableHash, writeJsonAtomic } from "./utils.js";

function now(): string {
  return new Date().toISOString();
}

export function validateSiteId(value: string): string {
  if (!/^[a-z][a-z0-9-]{0,62}$/.test(value)) {
    throw new Error("siteId must start with a lowercase letter and use only lowercase letters, numbers, and hyphens");
  }
  return value;
}

function nonEmptyStrings(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`${label} must contain at least one non-empty string`);
  }
  return value.map((item) => String(item).trim());
}

function safeConfigPath(value: string): string {
  if (!value || isAbsolute(value)) throw new Error("configPath must be a relative path inside the workspace");
  const normalized = normalize(value);
  if (normalized === ".." || normalized.startsWith(`..${sep}`)) {
    throw new Error("configPath must stay inside the workspace");
  }
  return normalized.split(sep).join("/");
}

function validateProposalInput(value: unknown): OnboardingProposalInput {
  if (!value || typeof value !== "object") throw new Error("onboarding proposal must be an object");
  const proposal = value as Record<string, any>;
  if (proposal.schemaVersion !== 1) throw new Error("onboarding proposal schemaVersion must be 1");
  const siteId = validateSiteId(String(proposal.siteId ?? ""));
  const configPath = safeConfigPath(String(proposal.configPath ?? ""));
  const agent = String(proposal.agent ?? "").trim();
  if (!agent) throw new Error("onboarding proposal agent is required");
  const assumptions = nonEmptyStrings(proposal.assumptions, "onboarding proposal assumptions");
  if (!Array.isArray(proposal.questions) || proposal.questions.length === 0) {
    throw new Error("onboarding proposal must ask the human at least one question");
  }
  const seen = new Set<string>();
  const questions = proposal.questions.map((question: any, index: number) => {
    const id = String(question?.id ?? "").trim();
    if (!/^[a-z][a-z0-9-]{0,62}$/.test(id)) throw new Error(`onboarding question ${index} has an invalid id`);
    if (seen.has(id)) throw new Error(`onboarding question id is duplicated: ${id}`);
    seen.add(id);
    const prompt = String(question?.prompt ?? "").trim();
    const assumedAnswer = String(question?.assumedAnswer ?? "").trim();
    if (!prompt || !assumedAnswer) throw new Error(`onboarding question ${id} needs a prompt and assumedAnswer`);
    return { id, prompt, assumedAnswer };
  });
  return { schemaVersion: 1, siteId, configPath, agent, assumptions, questions };
}

function validateAnswers(value: unknown, proposal: OnboardingProposal): HumanOnboardingAnswers {
  if (!value || typeof value !== "object") throw new Error("human answers must be an object");
  const answers = value as Record<string, any>;
  if (answers.schemaVersion !== 1 || answers.proposalId !== proposal.proposalId || answers.humanConfirmed !== true) {
    throw new Error("answers must match the proposal and set humanConfirmed: true");
  }
  if (!Array.isArray(answers.answers)) throw new Error("answers.answers must be an array");
  const expected = new Set(proposal.questions.map((question) => question.id));
  const seen = new Set<string>();
  const normalized = answers.answers.map((answer: any) => {
    const questionId = String(answer?.questionId ?? "").trim();
    const text = String(answer?.answer ?? "").trim();
    if (!expected.has(questionId)) throw new Error(`answer references unknown question: ${questionId}`);
    if (seen.has(questionId)) throw new Error(`question is answered more than once: ${questionId}`);
    if (!text) throw new Error(`answer for ${questionId} must not be empty`);
    seen.add(questionId);
    return { questionId, answer: text };
  });
  const missing = [...expected].filter((id) => !seen.has(id));
  if (missing.length > 0) throw new Error(`human answers are missing: ${missing.join(", ")}`);
  return { schemaVersion: 1, proposalId: proposal.proposalId, humanConfirmed: true, answers: normalized };
}

function validateWorkspace(value: unknown): WorkspaceConfig {
  if (!value || typeof value !== "object") throw new Error("workspace must be an object");
  const workspace = value as Record<string, any>;
  if (workspace.schemaVersion !== 1 || !Array.isArray(workspace.sites)) {
    throw new Error("workspace schemaVersion must be 1 and sites must be an array");
  }
  const ids = new Set<string>();
  const configPaths = new Set<string>();
  const sites: WorkspaceSite[] = workspace.sites.map((site: any) => {
    const id = validateSiteId(String(site?.id ?? ""));
    const configPath = safeConfigPath(String(site?.configPath ?? ""));
    if (ids.has(id)) throw new Error(`workspace site id is duplicated: ${id}`);
    if (configPaths.has(configPath)) throw new Error(`workspace config path is duplicated: ${configPath}`);
    ids.add(id);
    configPaths.add(configPath);
    if (site?.status !== "confirmed" || !site.proposalId || !site.configHash || !site.confirmedAt) {
      throw new Error(`workspace site ${id} is not a confirmed onboarding entry`);
    }
    return {
      id,
      configPath,
      status: "confirmed",
      proposalId: String(site.proposalId),
      configHash: String(site.configHash ?? ""),
      confirmedAt: String(site.confirmedAt),
    };
  });
  return { schemaVersion: 1, sites };
}

async function readStructured(path: string): Promise<unknown> {
  return parse(await readFile(path, "utf8"));
}

async function writeYamlAtomic(path: string, value: unknown): Promise<void> {
  await ensureDirectory(dirname(path));
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, stringify(value, { lineWidth: 100 }), "utf8");
  await rename(temporary, path);
}

async function assertWritableNewFile(path: string, force: boolean): Promise<void> {
  if (force) return;
  try {
    await access(path);
    throw new Error(`${path} already exists; pass --force to replace it`);
  } catch (error) {
    if (error instanceof Error && error.message.includes("already exists")) throw error;
  }
}

export async function draftSite(options: {
  siteId: string;
  url: string;
  configPath?: string;
  proposalPath?: string;
  agent?: string;
  force?: boolean;
  cwd?: string;
}): Promise<{ siteId: string; configPath: string; proposalPath: string }> {
  const cwd = options.cwd ?? process.cwd();
  const siteId = validateSiteId(options.siteId);
  const configPath = resolve(cwd, safeConfigPath(options.configPath ?? `yls-sites/${siteId}.yaml`));
  const proposalPath = resolve(cwd, options.proposalPath ?? `.yls/onboarding/${siteId}.draft.yaml`);
  if (!pathInside(cwd, proposalPath)) throw new Error("proposal draft must stay inside the project");
  await assertWritableNewFile(configPath, options.force === true);
  await assertWritableNewFile(proposalPath, options.force === true);
  const config = defaultConfig(options.url, expectedArtifactDirectory(siteId));
  config.watch = {
    enabled: true,
    schedule: {
      naturalLanguage: "daily at 09:00 UTC (agent assumption; confirm with human)",
      cron: "0 9 * * *",
      timezone: "UTC",
    },
    rules: [{
      id: "public-surface-health",
      instruction: "Report new verified defects and material changes to public headings or routes.",
      autonomy: "observe",
    }],
  };
  const relativeConfig = relative(cwd, configPath).split(sep).join("/");
  const proposal: OnboardingProposalInput = {
    schemaVersion: 1,
    siteId,
    configPath: relativeConfig,
    agent: options.agent?.trim() || "coding-agent",
    assumptions: [
      "This origin is a public surface safe for read-only navigation.",
      "The draft page roles, exclusions, watch cadence, and rules still need human confirmation.",
    ],
    questions: [
      { id: "confirm-scope", prompt: "Which public routes or flows must be included or excluded?", assumedAnswer: "Use the draft masks." },
      { id: "confirm-goals", prompt: "Which page goals and changes matter enough to report?", assumedAnswer: "Use the draft roles and watch rules." },
      { id: "confirm-cadence", prompt: "Should the proposed cadence, timezone, and autonomy levels be activated?", assumedAnswer: "Use the draft schedule in observe mode." },
    ],
  };
  await writeYamlAtomic(configPath, config);
  await writeYamlAtomic(proposalPath, proposal);
  await ensureDirectory(resolve(cwd, ".yls"));
  try {
    await access(resolve(cwd, ".yls", ".gitignore"));
  } catch {
    await writeFile(resolve(cwd, ".yls", ".gitignore"), "*\n!.gitignore\n", "utf8");
  }
  return { siteId, configPath, proposalPath };
}

export async function loadWorkspace(workspacePath = "yls.workspace.yaml", cwd = process.cwd()): Promise<{
  path: string;
  workspace: WorkspaceConfig;
}> {
  const path = resolve(cwd, workspacePath);
  try {
    return { path, workspace: validateWorkspace(await readStructured(path)) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { path, workspace: { schemaVersion: 1, sites: [] } };
    throw error;
  }
}

function expectedArtifactDirectory(siteId: string): string {
  return `.yls/sites/${siteId}`;
}

function assertSiteConfig(siteId: string, config: YlsConfig): void {
  if (normalize(config.artifacts.directory).split(sep).join("/") !== expectedArtifactDirectory(siteId)) {
    throw new Error(`site ${siteId} artifacts.directory must be ${expectedArtifactDirectory(siteId)}`);
  }
  if (!config.watch) throw new Error(`site ${siteId} must define watch schedule and natural-language rules`);
}

export async function proposeSite(options: {
  proposalFile: string;
  replace?: boolean;
  workspacePath?: string;
  cwd?: string;
}): Promise<{ proposal: OnboardingProposal; proposalPath: string }> {
  const cwd = options.cwd ?? process.cwd();
  const loadedWorkspace = await loadWorkspace(options.workspacePath, cwd);
  const input = validateProposalInput(await readStructured(resolve(cwd, options.proposalFile)));
  const existing = loadedWorkspace.workspace.sites.find((site) => site.id === input.siteId);
  if (existing && !options.replace) {
    throw new Error(`site is already confirmed: ${input.siteId}`);
  }
  const workspaceDirectory = dirname(loadedWorkspace.path);
  const configAbsolute = resolve(workspaceDirectory, input.configPath);
  if (!pathInside(workspaceDirectory, configAbsolute)) throw new Error("configPath must stay inside the workspace");
  const loadedConfig = await loadConfig(input.configPath, workspaceDirectory);
  assertSiteConfig(input.siteId, loadedConfig.config);
  const createdAt = now();
  const proposal: OnboardingProposal = {
    ...input,
    proposalId: `proposal-${input.siteId}-${stableHash(`${createdAt}-${Math.random()}`, 8)}`,
    createdAt,
    draftConfig: loadedConfig.config,
    ...(existing ? { replacesProposalId: existing.proposalId } : {}),
  };
  const proposalPath = resolve(workspaceDirectory, ".yls", "onboarding", input.siteId, `${proposal.proposalId}.json`);
  await writeJsonAtomic(proposalPath, proposal);
  await ensureDirectory(resolve(workspaceDirectory, ".yls"));
  try {
    await access(resolve(workspaceDirectory, ".yls", ".gitignore"));
  } catch {
    await writeFile(resolve(workspaceDirectory, ".yls", ".gitignore"), "*\n!.gitignore\n", "utf8");
  }
  return { proposal, proposalPath };
}

export async function confirmSite(options: {
  proposalPath: string;
  answersFile: string;
  configPath?: string;
  workspacePath?: string;
  cwd?: string;
}): Promise<{ site: WorkspaceSite; workspacePath: string; configPath: string }> {
  const cwd = options.cwd ?? process.cwd();
  const loadedWorkspace = await loadWorkspace(options.workspacePath, cwd);
  const workspaceDirectory = dirname(loadedWorkspace.path);
  const proposalAbsolute = resolve(cwd, options.proposalPath);
  const onboardingRoot = resolve(workspaceDirectory, ".yls", "onboarding");
  if (!pathInside(onboardingRoot, proposalAbsolute)) throw new Error("proposal must be a stored .yls/onboarding proposal");
  const proposalRaw = await readJson<OnboardingProposal>(proposalAbsolute);
  const proposalInput = validateProposalInput(proposalRaw);
  if (!/^proposal-[a-z0-9-]+-[a-f0-9]{8}$/.test(String(proposalRaw.proposalId ?? "")) || !proposalRaw.createdAt) {
    throw new Error("stored onboarding proposal metadata is invalid");
  }
  const proposal: OnboardingProposal = { ...proposalRaw, ...proposalInput };
  const answers = validateAnswers(await readStructured(resolve(cwd, options.answersFile)), proposal);
  const configPath = safeConfigPath(options.configPath ?? proposal.configPath);
  const loadedConfig = await loadConfig(configPath, workspaceDirectory);
  assertSiteConfig(proposal.siteId, loadedConfig.config);
  const existingSite = loadedWorkspace.workspace.sites.find((site) => site.id === proposal.siteId);
  if (existingSite && proposal.replacesProposalId !== existingSite.proposalId) {
    throw new Error(`site ${proposal.siteId} requires a replacement onboarding proposal`);
  }
  if (loadedWorkspace.workspace.sites.some((site) => site.id !== proposal.siteId && site.configPath === configPath)) {
    throw new Error(`config path is already used by another site: ${configPath}`);
  }
  for (const existing of loadedWorkspace.workspace.sites) {
    if (existing.id === proposal.siteId) continue;
    const existingConfig = await loadConfig(existing.configPath, workspaceDirectory);
    if (existingConfig.config.artifacts.directory === loadedConfig.config.artifacts.directory) {
      throw new Error(`artifacts.directory is already used by site ${existing.id}`);
    }
  }
  const site: WorkspaceSite = {
    id: proposal.siteId,
    configPath,
    status: "confirmed",
    proposalId: proposal.proposalId,
    configHash: stableHash(JSON.stringify(loadedConfig.config), 32),
    confirmedAt: now(),
  };
  loadedWorkspace.workspace.sites = loadedWorkspace.workspace.sites.filter((entry) => entry.id !== site.id);
  loadedWorkspace.workspace.sites.push(site);
  loadedWorkspace.workspace.sites.sort((a, b) => a.id.localeCompare(b.id));
  await writeYamlAtomic(loadedWorkspace.path, loadedWorkspace.workspace);
  await writeJsonAtomic(
    resolve(workspaceDirectory, ".yls", "onboarding", proposal.siteId, `${proposal.proposalId}.confirmation.json`),
    { schemaVersion: 1, site, answers, confirmedConfig: loadedConfig.config },
  );
  return { site, workspacePath: loadedWorkspace.path, configPath: loadedConfig.path };
}

export async function loadWorkspaceSite(options: {
  siteId: string;
  workspacePath?: string;
  cwd?: string;
}): Promise<{ site: WorkspaceSite; config: YlsConfig; configPath: string; workspacePath: string }> {
  const cwd = options.cwd ?? process.cwd();
  const loaded = await loadWorkspace(options.workspacePath, cwd);
  const siteId = validateSiteId(options.siteId);
  const site = loaded.workspace.sites.find((entry) => entry.id === siteId);
  if (!site) throw new Error(`unknown or unconfirmed site: ${siteId}`);
  const config = await loadConfig(site.configPath, dirname(loaded.path));
  const configHash = stableHash(JSON.stringify(config.config), 32);
  if (configHash !== site.configHash) {
    throw new Error(`site ${site.id} config changed after human confirmation; run site propose --replace and confirm it again`);
  }
  return { site, config: config.config, configPath: config.path, workspacePath: loaded.path };
}

export async function listWorkspaceSites(options: { workspacePath?: string; cwd?: string } = {}): Promise<{
  workspacePath: string;
  sites: Array<WorkspaceSite & { url: string; watchEnabled: boolean; configConfirmed: boolean; schedule?: string }>;
}> {
  const cwd = options.cwd ?? process.cwd();
  const loaded = await loadWorkspace(options.workspacePath, cwd);
  const sites = [];
  for (const site of loaded.workspace.sites) {
    const config = await loadConfig(site.configPath, dirname(loaded.path));
    sites.push({
      ...site,
      url: config.config.site.url,
      watchEnabled: config.config.watch?.enabled === true,
      configConfirmed: stableHash(JSON.stringify(config.config), 32) === site.configHash,
      ...(config.config.watch ? { schedule: config.config.watch.schedule.cron } : {}),
    });
  }
  return { workspacePath: loaded.path, sites };
}
