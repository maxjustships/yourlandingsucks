import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const expectedVersion = "0.1.0-alpha.0";
const packageSpec = process.env.YLS_PUBLIC_SPEC ?? `yourlandingsucks@${expectedVersion}`;
const npmCli = process.env.npm_execpath;

function run(command, args, cwd, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env },
      windowsHide: true,
      ...options,
    });
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
  const options = { env: { ...process.env, npm_config_cache: join(cwd, ".npm-cache") } };
  if (npmCli) return run(process.execPath, [npmCli, ...args], cwd, options);
  return run("npm", args, cwd, { ...options, shell: process.platform === "win32" });
}

const cwd = await mkdtemp(join(tmpdir(), "yls-public-install-smoke-"));
try {
  await writeFile(join(cwd, "package.json"), '{"name":"yls-public-install-smoke","version":"1.0.0","private":true}\n');
  await runNpm(["install", "--save-dev", "--no-audit", "--no-fund", packageSpec], cwd);

  const installed = JSON.parse(await readFile(join(cwd, "node_modules", "yourlandingsucks", "package.json"), "utf8"));
  assert.equal(installed.name, "yourlandingsucks");
  assert.equal(installed.version, expectedVersion);
  assert.equal((await runNpm(["exec", "--", "yls", "--version"], cwd)).stdout.trim(), expectedVersion);

  const install = JSON.parse((await runNpm(["exec", "--", "yls", "agent", "install", "--json"], cwd)).stdout);
  assert.equal(install.status, "installed");
  assert.equal(install.integration.current, true);

  const check = JSON.parse((await runNpm(["exec", "--", "yls", "agent", "check", "--json"], cwd)).stdout);
  assert.equal(check.current, true);
  assert.match(await readFile(join(cwd, "AGENTS.md"), "utf8"), /\.agents\/skills\/yourlandingsucks\/SKILL\.md/);

  process.stdout.write(`Public install passed for ${installed.name}@${installed.version} from ${packageSpec}.\n`);
} finally {
  await rm(cwd, { recursive: true, force: true });
}
