import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const npmCli = process.env.npm_execpath;

function run(command, args, cwd, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, env: { ...process.env }, windowsHide: true, ...options });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (status) => {
      if (status === 0) resolvePromise({ stdout, stderr });
      else reject(new Error(`${command} ${args.join(" ")} failed (${status})\n${stdout}\n${stderr}`));
    });
  });
}

function runNpm(args, cwd) {
  if (npmCli) return run(process.execPath, [npmCli, ...args], cwd);
  return run("npm", args, cwd, { shell: process.platform === "win32" });
}

const cwd = await mkdtemp(join(tmpdir(), "yls-install-smoke-"));
try {
  await writeFile(join(cwd, "package.json"), '{"name":"yls-install-smoke","version":"1.0.0","private":true}\n');
  const packed = await runNpm(["pack", root, "--pack-destination", cwd, "--json"], cwd);
  const packResult = JSON.parse(packed.stdout);
  const tarball = join(cwd, packResult[0].filename);
  await runNpm(["install", "--save-dev", "--ignore-scripts", "--no-audit", "--no-fund", tarball], cwd);

  const installed = JSON.parse(await readFile(join(cwd, "node_modules", "yourlandingsucks", "package.json"), "utf8"));
  const installedSkill = await readFile(join(cwd, "node_modules", "yourlandingsucks", "skills", "yourlandingsucks", "SKILL.md"), "utf8");
  assert.equal(installed.name, "yourlandingsucks");
  assert.equal(installed.version, "0.1.0-alpha.0");
  assert.match(installedSkill, /name: yourlandingsucks/);
  assert.match(installedSkill, /references\/onboarding\.md/);
  const help = await runNpm(["exec", "--", "yls", "help"], cwd);
  assert.match(help.stdout, /yls issue sync/);
  assert.match(help.stdout, /yls site draft/);
  assert.match(help.stdout, /yls watch tick/);
  assert.match(help.stdout, /yls watch plan/);
  assert.match(help.stdout, /yls watch status/);
  assert.match(help.stdout, /yls agent install/);
  assert.match(help.stdout, /YLS never calls an LLM/);
  assert.equal((await runNpm(["exec", "--", "yls", "--version"], cwd)).stdout.trim(), "0.1.0-alpha.0");
  const agentInstall = JSON.parse((await runNpm(["exec", "--", "yls", "agent", "install", "--json"], cwd)).stdout);
  assert.equal(agentInstall.status, "installed");
  assert.equal(agentInstall.integration.current, true);
  const durableSkill = await readFile(join(cwd, ".agents", "skills", "yourlandingsucks", "SKILL.md"), "utf8");
  const durableRecommendations = await readFile(join(cwd, ".agents", "skills", "yourlandingsucks", "references", "intents-and-recommendations.md"), "utf8");
  const durableInstructions = await readFile(join(cwd, "AGENTS.md"), "utf8");
  assert.match(durableSkill, /intents-and-recommendations\.md/i);
  assert.match(durableRecommendations, /contextual recommendation cards/i);
  assert.match(durableInstructions, /natural language into YLS primitives/i);
  const agentCheck = JSON.parse((await runNpm(["exec", "--", "yls", "agent", "check", "--json"], cwd)).stdout);
  assert.equal(agentCheck.current, true);

  const gitProject = join(cwd, "git-project");
  await mkdir(gitProject);
  await writeFile(join(gitProject, "package.json"), '{"name":"yls-git-install-smoke","version":"1.0.0","private":true}\n');
  const revision = (await run("git", ["-c", `safe.directory=${root}`, "rev-parse", "HEAD"], root)).stdout.trim();
  const gitSource = `git+${pathToFileURL(root).href}#${revision}`;
  await runNpm(["install", "--save-dev", "--no-audit", "--no-fund", gitSource], gitProject);
  const gitInstalled = JSON.parse(await readFile(join(gitProject, "node_modules", "yourlandingsucks", "package.json"), "utf8"));
  const gitInstalledSkill = await readFile(join(gitProject, "node_modules", "yourlandingsucks", "skills", "yourlandingsucks", "SKILL.md"), "utf8");
  const gitHelp = await runNpm(["exec", "--", "yls", "help"], gitProject);
  assert.equal(gitInstalled.version, "0.1.0-alpha.0");
  assert.match(gitInstalledSkill, /human confirms its proposal/i);
  assert.match(gitHelp.stdout, /yls feedback aggregate/);
  assert.match(gitHelp.stdout, /yls site draft/);
  assert.match(gitHelp.stdout, /yls watch tick/);
  assert.match(gitHelp.stdout, /yls watch register/);
  const gitAgentInstall = JSON.parse((await runNpm(["exec", "--", "yls", "agent", "install", "--json"], gitProject)).stdout);
  assert.equal(gitAgentInstall.integration.current, true);
  assert.match(await readFile(join(gitProject, "AGENTS.md"), "utf8"), /\.agents\/skills\/yourlandingsucks\/SKILL\.md/);
  process.stdout.write(`Installed ${installed.name}@${installed.version} with a durable Agent Skill from tarball and pinned git source; local yls binary passed.\n`);
} finally {
  await rm(cwd, { recursive: true, force: true });
}
