import { createHash } from "node:crypto";
import { lstat, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureDirectory, packageVersion, pathInside } from "./utils.js";

const skillRelativeDirectory = ".agents/skills/yourlandingsucks";
const manifestName = ".yourlandingsucks.json";
const agentsFileName = "AGENTS.md";
const beginMarker = "<!-- yourlandingsucks:begin -->";
const endMarker = "<!-- yourlandingsucks:end -->";

interface AgentSkillManifest {
  schemaVersion: 1;
  toolVersion: string;
  sourceHash: string;
  managedFiles: string[];
}

export interface AgentIntegrationCheck {
  status: "current" | "missing" | "stale" | "conflict";
  installed: boolean;
  current: boolean;
  skillDirectory: string;
  instructionsFile: string;
  managedFiles: string[];
  toolVersion: string;
  sourceHash: string;
  problems: string[];
}

export interface AgentIntegrationInstall {
  status: "installed" | "updated" | "unchanged";
  integration: AgentIntegrationCheck;
  examplePrompts: string[];
}

function portablePath(value: string): string {
  return value.split(sep).join("/");
}

function bundledSkillDirectory(): string {
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  return resolve(packageRoot, "skills", "yourlandingsucks");
}

function managedBlock(newline = "\n"): string {
  return [
    beginMarker,
    "## YourLandingSucks agent capability",
    "",
    "When the user asks to inspect, criticize, improve, fix, verify, compare, monitor, or learn from any public page, load and follow `.agents/skills/yourlandingsucks/SKILL.md`.",
    "",
    "Translate the user's natural language into YLS primitives. Do not ask the user to run YLS commands, inspect YLS artifacts, or edit YLS configuration. Ask only for product decisions or external authority that cannot be inferred safely.",
    endMarker,
  ].join(newline);
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function assertNoSymlink(root: string, target: string): Promise<void> {
  if (!pathInside(root, target)) throw new Error(`Agent integration path escapes the project: ${target}`);
  const rel = relative(resolve(root), resolve(target));
  let current = resolve(root);
  for (const segment of rel.split(sep).filter(Boolean)) {
    current = join(current, segment);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) throw new Error(`Agent integration refuses symbolic link: ${portablePath(relative(root, current))}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }
}

async function writeTextAtomic(path: string, value: string): Promise<void> {
  await ensureDirectory(dirname(path));
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, value, "utf8");
  await rename(temporary, path);
}

async function listFiles(directory: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(resolve(directory, prefix), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = prefix ? join(prefix, entry.name) : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`Bundled Agent Skill contains a symbolic link: ${portablePath(rel)}`);
    if (entry.isDirectory()) files.push(...await listFiles(directory, rel));
    else if (entry.isFile()) files.push(portablePath(rel));
  }
  return files;
}

async function sourceSnapshot(): Promise<{ directory: string; files: Map<string, string>; hash: string }> {
  const directory = bundledSkillDirectory();
  const names = await listFiles(directory);
  if (!names.includes("SKILL.md")) throw new Error(`Bundled Agent Skill is missing SKILL.md: ${directory}`);
  const files = new Map<string, string>();
  const hash = createHash("sha256");
  for (const name of names) {
    const content = await readFile(resolve(directory, ...name.split("/")), "utf8");
    files.set(name, content);
    hash.update(name).update("\0").update(content).update("\0");
  }
  return { directory, files, hash: hash.digest("hex") };
}

function validateManagedFile(name: string, skillDirectory: string): string {
  if (!name || isAbsolute(name) || name.includes("\\")) throw new Error(`Invalid managed Agent Skill path: ${name}`);
  const output = resolve(skillDirectory, ...name.split("/"));
  if (!pathInside(skillDirectory, output)) throw new Error(`Managed Agent Skill path escapes its directory: ${name}`);
  return output;
}

async function readManifest(path: string): Promise<AgentSkillManifest | undefined> {
  const raw = await readOptional(path);
  if (raw === undefined) return undefined;
  const value = JSON.parse(raw) as Partial<AgentSkillManifest>;
  if (value.schemaVersion !== 1 || typeof value.toolVersion !== "string" || typeof value.sourceHash !== "string" ||
      !Array.isArray(value.managedFiles) || !value.managedFiles.every((item) => typeof item === "string")) {
    throw new Error("Agent Skill manifest is invalid");
  }
  return value as AgentSkillManifest;
}

function markerState(content: string | undefined): "absent" | "current" | "stale" | "conflict" {
  if (content === undefined) return "absent";
  const start = content.indexOf(beginMarker);
  const end = content.indexOf(endMarker);
  if (start < 0 && end < 0) return "absent";
  if (start < 0 || end < start || start !== content.lastIndexOf(beginMarker) || end !== content.lastIndexOf(endMarker)) return "conflict";
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  return content.slice(start, end + endMarker.length) === managedBlock(newline) ? "current" : "stale";
}

function upsertManagedBlock(content: string | undefined): string {
  const original = content ?? "";
  const state = markerState(content);
  if (state === "conflict") throw new Error(`${agentsFileName} contains incomplete or duplicate YourLandingSucks markers`);
  const newline = original.includes("\r\n") ? "\r\n" : "\n";
  const block = managedBlock(newline);
  if (state === "current") return original;
  if (state === "stale") {
    const start = original.indexOf(beginMarker);
    const end = original.indexOf(endMarker) + endMarker.length;
    return `${original.slice(0, start)}${block}${original.slice(end)}`;
  }
  const trimmed = original.replace(/[\r\n]+$/g, "");
  return trimmed ? `${trimmed}${newline}${newline}${block}${newline}` : `${block}${newline}`;
}

export async function checkAgentIntegration(options: { cwd?: string } = {}): Promise<AgentIntegrationCheck> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const source = await sourceSnapshot();
  const skillDirectory = resolve(cwd, ...skillRelativeDirectory.split("/"));
  const manifestPath = resolve(skillDirectory, manifestName);
  const instructionsFile = resolve(cwd, agentsFileName);
  const problems: string[] = [];
  try {
    await assertNoSymlink(cwd, skillDirectory);
    await assertNoSymlink(cwd, instructionsFile);
  } catch (error) {
    problems.push(error instanceof Error ? error.message : String(error));
  }
  const targetExists = await pathExists(skillDirectory);
  let manifest: AgentSkillManifest | undefined;
  try {
    manifest = await readManifest(manifestPath);
  } catch (error) {
    problems.push(`Agent Skill manifest is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (targetExists && !manifest) problems.push("Agent Skill directory exists but is not managed by YourLandingSucks");

  if (manifest) {
    if (manifest.sourceHash !== source.hash) problems.push("Installed Agent Skill is from a different YLS version");
    const expectedNames = [...source.files.keys()];
    if (JSON.stringify(manifest.managedFiles) !== JSON.stringify(expectedNames)) problems.push("Agent Skill managed-file list is stale");
    for (const name of expectedNames) {
      const target = validateManagedFile(name, skillDirectory);
      const installed = await readOptional(target);
      if (installed !== source.files.get(name)) problems.push(`Agent Skill file is missing or changed: ${name}`);
    }
  }

  const agentsContent = await readOptional(instructionsFile);
  const agentsState = markerState(agentsContent);
  if (agentsState === "conflict") problems.push(`${agentsFileName} contains incomplete or duplicate YourLandingSucks markers`);
  else if (agentsState !== "current") problems.push(`${agentsFileName} does not contain the current YourLandingSucks capability block`);

  const conflict = problems.some((problem) => problem.includes("not managed") || problem.includes("invalid") ||
    problem.includes("incomplete or duplicate") || problem.includes("symbolic link"));
  const installed = Boolean(manifest);
  const current = installed && problems.length === 0;
  const status: AgentIntegrationCheck["status"] = current ? "current" : conflict ? "conflict" : installed || targetExists ? "stale" : "missing";
  return {
    status,
    installed,
    current,
    skillDirectory: portablePath(relative(cwd, skillDirectory)),
    instructionsFile: portablePath(relative(cwd, instructionsFile)),
    managedFiles: [...source.files.keys()].map((name) => `${skillRelativeDirectory}/${name}`),
    toolVersion: packageVersion(),
    sourceHash: source.hash,
    problems,
  };
}

export async function installAgentIntegration(options: { cwd?: string } = {}): Promise<AgentIntegrationInstall> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const before = await checkAgentIntegration({ cwd });
  if (before.status === "conflict") throw new Error(before.problems.join("; "));
  if (before.current) return {
    status: "unchanged",
    integration: before,
    examplePrompts: examplePrompts(),
  };

  const source = await sourceSnapshot();
  const skillDirectory = resolve(cwd, ...skillRelativeDirectory.split("/"));
  const manifestPath = resolve(skillDirectory, manifestName);
  const instructionsFile = resolve(cwd, agentsFileName);
  await assertNoSymlink(cwd, skillDirectory);
  await assertNoSymlink(cwd, manifestPath);
  await assertNoSymlink(cwd, instructionsFile);

  const previousManifest = await readManifest(manifestPath);
  for (const [name, content] of source.files) {
    const target = validateManagedFile(name, skillDirectory);
    await assertNoSymlink(cwd, target);
    await writeTextAtomic(target, content);
  }
  for (const stale of previousManifest?.managedFiles ?? []) {
    if (source.files.has(stale)) continue;
    const target = validateManagedFile(stale, skillDirectory);
    await assertNoSymlink(cwd, target);
    const info = await lstat(target).catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? undefined : Promise.reject(error));
    if (info?.isDirectory()) throw new Error(`Refusing to remove managed path that became a directory: ${stale}`);
    await rm(target, { force: true });
  }
  const manifest: AgentSkillManifest = {
    schemaVersion: 1,
    toolVersion: packageVersion(),
    sourceHash: source.hash,
    managedFiles: [...source.files.keys()],
  };
  await writeTextAtomic(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const agentsContent = await readOptional(instructionsFile);
  const updatedAgents = upsertManagedBlock(agentsContent);
  if (updatedAgents !== agentsContent) await writeTextAtomic(instructionsFile, updatedAgents);

  const integration = await checkAgentIntegration({ cwd });
  if (!integration.current) throw new Error(`Agent integration did not verify: ${integration.problems.join("; ")}`);
  return {
    status: before.status === "missing" ? "installed" : "updated",
    integration,
    examplePrompts: examplePrompts(),
  };
}

function examplePrompts(): string[] {
  return [
    "Проверь мои публичные страницы и предложи до трёх конкретных улучшений.",
    "Исправь безопасные подтверждённые дефекты и проверь результат на preview.",
    "Следи за публичными страницами по будням и сообщай о важных изменениях.",
  ];
}
