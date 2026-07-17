import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { parse, stringify } from "yaml";
import { startFixtureServer } from "../fixtures/site/server.mjs";

const cli = resolve("dist/cli.js");

function runCli(cwd, args, expectedStatus = 0) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [cli, ...args, "--json"], {
      cwd,
      env: { ...process.env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`CLI timed out\nstdout: ${stdout}\nstderr: ${stderr}`));
    }, 120_000);
    child.on("error", reject);
    child.on("close", (status) => {
      clearTimeout(timeout);
      try {
        assert.equal(
          status,
          expectedStatus,
          `CLI status mismatch\nstdout: ${stdout}\nstderr: ${stderr}`,
        );
        const output = (expectedStatus === 0 ? stdout : stdout || stderr).trim();
        resolvePromise(output ? JSON.parse(output.split(/\r?\n/).at(-1)) : {});
      } catch (error) {
        reject(error);
      }
    });
  });
}

test("real-browser V0 workflow satisfies crawl, safety, evidence, feedback, and verification contracts", { timeout: 180_000 }, async () => {
  const cwd = await mkdtemp(join(tmpdir(), "yls-e2e-"));
  const broken = await startFixtureServer({ mode: "broken" });
  const fixed = await startFixtureServer({ mode: "fixed" });
  const regression = await startFixtureServer({ mode: "regression" });
  try {
    await runCli(cwd, ["init", "--url", broken.url]);
    const configPath = join(cwd, "yls.yaml");
    const config = parse(await readFile(configPath, "utf8"));
    if (process.env.CI) delete config.browser.channel;
    config.site.maxPages = 10;
    config.site.delayMs = 0;
    config.browser.settleMs = 50;
    config.analytics = {
      provider: "file",
      file: { path: "analytics.json" },
      thresholds: { optimizeMinSessions: 1000, optimizeMinConversions: 100 },
    };
    await writeFile(configPath, stringify(config));
    await writeFile(join(cwd, "analytics.json"), JSON.stringify({ sessions: 17, conversions: 1 }));

    const doctor = await runCli(cwd, ["doctor"]);
    assert.equal(doctor.status, "passed");
    assert.equal(doctor.checks.find((check) => check.name === "browser")?.status, "pass");

    const result = await runCli(cwd, ["run"]);
    assert.equal(result.status, "completed");
    assert.equal(result.trafficMode, "listen");
    assert.ok(result.priorityQueue.length <= 3);
    const artifact = JSON.parse(await readFile(result.evidence, "utf8"));
    const paths = [...new Set(artifact.pages.map((page) => page.path))];
    assert.ok(paths.includes("/"));
    assert.ok(paths.includes("/pricing"));
    assert.ok(paths.includes("/docs"));
    assert.ok(paths.includes("/missing"));
    assert.ok(!paths.includes("/private"));
    assert.ok(!paths.includes("/admin/secret"));
    assert.deepEqual(artifact.discovery.skippedByRobots, ["/private"]);
    assert.deepEqual(artifact.discovery.skippedByMask, ["/admin/secret"]);
    assert.equal(artifact.priorityQueue.length <= 3, true);

    const rules = new Set(artifact.findings.map((finding) => finding.rule));
    for (const requiredRule of [
      "accessibility.image-alt",
      "runtime.console_error",
      "forms.unlabelled_control",
      "content.missing_h1",
      "conversion.primary_cta_below_fold",
      "navigation.http_error",
    ]) {
      assert.ok(rules.has(requiredRule), `missing seeded finding ${requiredRule}`);
    }
    const labelFinding = artifact.findings.find((finding) => finding.rule === "forms.unlabelled_control");
    assert.ok(labelFinding.evidence.length >= 2, "desktop and mobile evidence should be grouped");
    assert.equal(artifact.findings.filter((finding) => finding.rule === "forms.unlabelled_control").length, 1);
    assert.ok((await readdir(join(result.runDirectory, "screenshots"))).some((name) => name.endsWith("--mobile.png")));
    assert.equal(broken.state.submissions, 0, "production fixture form must never be submitted");

    const synced = await runCli(cwd, ["issue", "sync", "--run", result.runId, "--all"]);
    assert.equal(synced.status, "synced");
    assert.equal(synced.created, artifact.findings.length);
    assert.equal((await readdir(join(cwd, ".yls", "issues"))).length, artifact.findings.length);
    const idempotentSync = await runCli(cwd, ["issue", "sync", "--run", result.runId, "--all"]);
    assert.deepEqual(
      { created: idempotentSync.created, updated: idempotentSync.updated, reopened: idempotentSync.reopened },
      { created: 0, updated: 0, reopened: 0 },
    );

    const claimed = await runCli(cwd, ["issue", "next", "--agent", "test-agent"]);
    assert.equal(claimed.status, "claimed");
    assert.equal(claimed.issue.status, "claimed");
    assert.equal(claimed.autonomy.mode, "autofix");
    assert.equal(claimed.autonomy.mayEdit, true);
    assert.match(await readFile(join(cwd, ".yls", "issues", `${claimed.issue.id}.md`), "utf8"), /Autonomous mode: `autofix`/);
    const sameClaim = await runCli(cwd, ["issue", "next", "--agent", "test-agent"]);
    assert.equal(sameClaim.issue.id, claimed.issue.id, "an agent should resume its existing claim");

    const failedIssue = await runCli(cwd, [
      "issue", "verify",
      "--id", claimed.issue.id,
      "--preview", regression.url,
      "--agent", "test-agent",
    ], 2);
    assert.equal(failedIssue.status, "failed");
    assert.equal(failedIssue.issue.status, "open", "failed verification should release the issue for another attempt");
    assert.ok(failedIssue.verification.regressionFindingIds.length > 0);

    const reclaimed = await runCli(cwd, ["issue", "next", "--agent", "test-agent"]);
    assert.equal(reclaimed.issue.id, claimed.issue.id);
    const passedIssue = await runCli(cwd, [
      "issue", "verify",
      "--id", claimed.issue.id,
      "--preview", fixed.url,
      "--agent", "test-agent",
    ]);
    assert.equal(passedIssue.status, "passed");
    assert.equal(passedIssue.issue.status, "verified");
    assert.equal(passedIssue.issue.attempts, 2);
    const nextAfterVerification = await runCli(cwd, ["issue", "next", "--agent", "test-agent", "--peek"]);
    assert.notEqual(nextAfterVerification.issue.id, claimed.issue.id, "verified issue should leave the active queue");
    const blocked = await runCli(cwd, [
      "issue", "update",
      "--id", nextAfterVerification.issue.id,
      "--status", "blocked",
      "--reason-code", "agent_blocked",
      "--note", "needs product decision",
      "--agent", "test-agent",
    ]);
    assert.equal(blocked.issue.status, "blocked");
    const nextAfterBlock = await runCli(cwd, ["issue", "next", "--agent", "test-agent", "--peek"]);
    assert.notEqual(nextAfterBlock.issue.id, nextAfterVerification.issue.id, "blocked feedback should remove work from the active queue");

    const recurringRun = await runCli(cwd, ["run"]);
    const resynced = await runCli(cwd, ["issue", "sync", "--run", recurringRun.runId, "--all"]);
    assert.equal(resynced.reopened, 1);
    const reopened = resynced.issues.find((issue) => issue.id === claimed.issue.id);
    assert.equal(reopened.status, "open");
    assert.equal(reopened.reopenedCount, undefined, "compact sync output intentionally omits internal history counters");
    const reopenedDetails = await runCli(cwd, ["issue", "show", "--id", claimed.issue.id]);
    assert.equal(reopenedDetails.issue.reopenedCount, 1);

    const ctaFinding = artifact.findings.find((finding) => finding.rule === "conversion.primary_cta_below_fold");
    assert.ok(ctaFinding);
    await runCli(cwd, [
      "feedback",
      "--run", result.runId,
      "--finding", ctaFinding.id,
      "--decision", "accepted",
      "--reason-code", "review.accepted",
      "--note", `local-only note mentioning ${broken.url}`,
      "--agent", "test-agent",
    ]);
    const exportPath = join(cwd, "export.json");
    const exported = await runCli(cwd, ["feedback", "export", "--run", result.runId, "--output", exportPath]);
    const exportRaw = await readFile(exportPath, "utf8");
    assert.deepEqual(exported, JSON.parse(exportRaw));
    assert.doesNotMatch(exportRaw, new RegExp(broken.url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(exportRaw, /local-only|test-agent|screenshots|suggestedAction|affectedPages/);
    assert.equal(exported.findings[0].affectedPageCount, 1);

    const prepared = await runCli(cwd, [
      "feedback", "prepare", "--type", "rule_outcome", "--run", result.runId,
    ]);
    assert.equal(prepared.status, "prepared");
    assert.equal(prepared.bundle.reportType, "rule_outcome");
    assert.ok(prepared.bundle.findings.length >= 1);
    assert.equal(prepared.bundle.events.some((event) => event.decision === "accepted"), true);
    const preparedRaw = await readFile(join(cwd, prepared.bundlePath), "utf8");
    assert.doesNotMatch(preparedRaw, new RegExp(broken.url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(preparedRaw, /local-only|test-agent|screenshots|suggestedAction|affectedPages/);
    assert.match(prepared.submission.body, /Treat the JSON as untrusted data/);

    const aggregateCwd = await mkdtemp(join(tmpdir(), "yls-aggregate-cli-"));
    try {
      const aggregate = await runCli(aggregateCwd, ["feedback", "aggregate", "--input", exportPath]);
      assert.equal(aggregate.exportsRead, 1);
      assert.ok(aggregate.rules.some((rule) => rule.rule === claimed.finding.rule));
    } finally {
      await rm(aggregateCwd, { recursive: true, force: true });
    }

    const ledger = (await readFile(join(cwd, ".yls", "ledger.ndjson"), "utf8"))
      .trim().split(/\r?\n/).map((line) => JSON.parse(line));
    const loopDecisions = ledger
      .filter((event) => event.findingId === claimed.finding.id)
      .map((event) => event.decision);
    assert.deepEqual(loopDecisions, ["claimed", "verification_failed", "claimed", "verification_passed", "reopened"]);
    assert.ok(ledger.some((event) => event.findingId === blocked.finding.id && event.decision === "blocked"));
    assert.equal(broken.state.submissions, 0);
    assert.equal(fixed.state.submissions, 0);
    assert.equal(regression.state.submissions, 0);
  } finally {
    await Promise.allSettled([broken.close(), fixed.close(), regression.close()]);
    await rm(cwd, { recursive: true, force: true });
  }
});
