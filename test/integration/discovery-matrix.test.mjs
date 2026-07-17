import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { parse, stringify } from "yaml";
import { startDiscoveryMatrixServer } from "../fixtures/site/matrix-server.mjs";

const cli = resolve("dist/cli.js");

function runCli(cwd, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [cli, ...args, "--json"], { cwd, env: { ...process.env } });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (status) => {
      try {
        assert.equal(status, 0, `CLI failed\nstdout: ${stdout}\nstderr: ${stderr}`);
        resolvePromise(JSON.parse(stdout.trim().split(/\r?\n/).at(-1)));
      } catch (error) {
        reject(error);
      }
    });
  });
}

test("discovery handles sitemap indexes, rendered SPA links, bounds, masks, robots, queries, and off-origin redirects", { timeout: 120_000 }, async () => {
  const cwd = await mkdtemp(join(tmpdir(), "yls-discovery-"));
  const fixture = await startDiscoveryMatrixServer();
  try {
    await runCli(cwd, ["init", "--url", fixture.url]);
    const configPath = join(cwd, "yls.yaml");
    const config = parse(await readFile(configPath, "utf8"));
    if (process.env.CI) delete config.browser.channel;
    config.site.maxPages = 10;
    config.site.maxDepth = 1;
    config.site.delayMs = 0;
    config.browser.settleMs = 120;
    await writeFile(configPath, stringify(config));

    const result = await runCli(cwd, ["run"]);
    const artifact = JSON.parse(await readFile(result.evidence, "utf8"));
    const paths = artifact.discovery.urls.map((url) => new URL(url).pathname);

    assert.ok(paths.includes("/from-sitemap"), "nested sitemap URL should be discovered");
    assert.ok(paths.includes("/spa"), "link inserted after DOMContentLoaded should be discovered");
    assert.equal(paths.filter((path) => path === "/spa").length, 1, "query variants should canonicalize");
    assert.ok(paths.includes("/level-one"));
    assert.ok(!paths.includes("/level-two"), "maxDepth should bound rendered-link crawling");
    assert.deepEqual(artifact.discovery.skippedByRobots, ["/robots-hidden"]);
    assert.deepEqual(artifact.discovery.skippedByMask, ["/admin/hidden"]);
    assert.deepEqual(artifact.discovery.redirectedOffOrigin, [`${fixture.url}/redirect-external`]);
    assert.ok(artifact.findings.some((finding) => finding.rule === "navigation.off_origin_redirect"));
  } finally {
    await fixture.close();
    await rm(cwd, { recursive: true, force: true });
  }
});
