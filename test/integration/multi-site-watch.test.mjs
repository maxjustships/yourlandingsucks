import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { stringify } from "yaml";
import { defaultConfig } from "../../dist/index.js";
import { startWatchFixture } from "../fixtures/site/watch-server.mjs";

const cli = resolve("dist/cli.js");

function runCli(cwd, args, expectedStatus = 0) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [cli, ...args, "--json"], { cwd, env: { ...process.env } });
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
        assert.equal(status, expectedStatus, `CLI status mismatch\nstdout: ${stdout}\nstderr: ${stderr}`);
        const output = (expectedStatus === 0 ? stdout : stdout || stderr).trim();
        resolvePromise(output ? JSON.parse(output.split(/\r?\n/).at(-1)) : {});
      } catch (error) {
        reject(error);
      }
    });
  });
}

function siteConfig(url, id, cron, instruction) {
  const config = defaultConfig(url, `.yls/sites/${id}`);
  config.site.maxPages = 5;
  config.site.maxDepth = 1;
  config.site.delayMs = 0;
  config.browser.settleMs = 20;
  if (process.env.CI) delete config.browser.channel;
  config.artifacts.screenshots = false;
  config.pages = [{ match: ["/**"], role: "informational" }];
  config.watch = {
    enabled: true,
    schedule: { naturalLanguage: cron === "* * * * *" ? "every minute" : "every five minutes", cron, timezone: "UTC" },
    rules: [{ id: `${id}-policy`, instruction, autonomy: "observe" }],
  };
  return config;
}

async function propose(cwd, id, configPath, replace = false) {
  const proposalPath = join(cwd, `${id}.proposal.yaml`);
  await writeFile(proposalPath, stringify({
    schemaVersion: 1,
    siteId: id,
    configPath,
    agent: "test-agent",
    assumptions: [`${id} is a public informational surface`, "the proposed cadence is acceptable"],
    questions: [
      { id: "confirm-purpose", prompt: "Is the assumed page purpose correct?", assumedAnswer: "yes" },
      { id: "confirm-cadence", prompt: "Should this schedule be activated?", assumedAnswer: "yes" },
    ],
  }));
  return runCli(cwd, ["site", "propose", "--file", proposalPath, ...(replace ? ["--replace"] : [])]);
}

async function answers(cwd, proposal, id, complete = true) {
  const path = join(cwd, `${id}.answers.yaml`);
  await writeFile(path, stringify({
    schemaVersion: 1,
    proposalId: proposal.proposalId,
    humanConfirmed: true,
    answers: [
      { questionId: "confirm-purpose", answer: "Yes, keep it informational." },
      ...(complete ? [{ questionId: "confirm-cadence", answer: "Yes, activate it." }] : []),
    ],
  }));
  return path;
}

test("multi-site onboarding gates activation and watch runner isolates rules, schedules, deltas, and failures", { timeout: 180_000 }, async () => {
  const cwd = await mkdtemp(join(tmpdir(), "yls-multi-site-"));
  const alpha = await startWatchFixture({ name: "Alpha" });
  const beta = await startWatchFixture({ name: "Beta" });
  try {
    const configDirectory = join(cwd, "yls-sites");
    await mkdir(configDirectory, { recursive: true });
    const alphaConfigPath = "yls-sites/alpha.yaml";
    const betaConfigPath = "yls-sites/beta.yaml";
    const alphaConfig = siteConfig(alpha.url, "alpha", "* * * * *", "Report any change to the main promise or public route set.");
    const betaConfig = siteConfig(beta.url, "beta", "*/5 * * * *", "Report HTTP failures, but do not change code.");
    await writeFile(join(cwd, alphaConfigPath), stringify(alphaConfig));
    await writeFile(join(cwd, betaConfigPath), stringify(betaConfig));

    const badProposal = join(cwd, "bad.proposal.yaml");
    await writeFile(badProposal, stringify({ schemaVersion: 1, siteId: "../escape", configPath: alphaConfigPath, agent: "agent", assumptions: [], questions: [] }));
    const rejectedProposal = await runCli(cwd, ["site", "propose", "--file", badProposal], 1);
    assert.match(rejectedProposal.message, /siteId|assumptions/);

    const alphaProposal = await propose(cwd, "alpha", alphaConfigPath);
    assert.equal(alphaProposal.status, "awaiting_human_confirmation");
    assert.equal(alphaProposal.questions.length, 2);
    const incomplete = await answers(cwd, alphaProposal, "alpha-incomplete", false);
    const unstoredConfirmation = await runCli(cwd, [
      "site", "confirm", "--proposal", join(cwd, "alpha.proposal.yaml"), "--answers", incomplete,
    ], 1);
    assert.match(unstoredConfirmation.message, /stored \.yls\/onboarding proposal/);
    const blockedConfirmation = await runCli(cwd, [
      "site", "confirm", "--proposal", alphaProposal.proposalPath, "--answers", incomplete,
    ], 1);
    assert.match(blockedConfirmation.message, /missing: confirm-cadence/);
    assert.equal((await runCli(cwd, ["site", "list"])).count, 0);

    const alphaAnswers = await answers(cwd, alphaProposal, "alpha");
    await runCli(cwd, ["site", "confirm", "--proposal", alphaProposal.proposalPath, "--answers", alphaAnswers]);
    const betaProposal = await propose(cwd, "beta", betaConfigPath);
    const betaAnswers = await answers(cwd, betaProposal, "beta");
    await runCli(cwd, ["site", "confirm", "--proposal", betaProposal.proposalPath, "--answers", betaAnswers]);

    const listed = await runCli(cwd, ["site", "list"]);
    assert.equal(listed.count, 2);
    assert.deepEqual(listed.sites.map((site) => site.id), ["alpha", "beta"]);
    assert.notEqual(listed.sites[0].schedule, listed.sites[1].schedule);

    const watchPlan = await runCli(cwd, ["watch", "plan"]);
    assert.equal(watchPlan.status, "activation_required");
    assert.deepEqual(watchPlan.sites.map((site) => site.siteId), ["alpha", "beta"]);
    assert.deepEqual(watchPlan.sites[0].invocation.args.slice(0, 4), ["--no-install", "yls", "watch", "run"]);
    assert.equal(watchPlan.sites[0].registrationCurrent, false);
    const unregisteredStatus = await runCli(cwd, ["watch", "status"], 1);
    assert.deepEqual(unregisteredStatus.sites.map((site) => site.health), ["not_registered", "not_registered"]);

    const alphaBaseline = await runCli(cwd, ["watch", "run", "--site", "alpha", "--at", "2026-07-17T10:10:00.000Z"]);
    assert.equal(alphaBaseline.packets[0].delta.baseline, true);
    assert.equal(alphaBaseline.packets[0].rules[0].id, "alpha-policy");
    assert.match(alphaBaseline.packets[0].runDirectory.replace(/\\/g, "/"), /\.yls\/sites\/alpha\/runs/);

    const firstTick = await runCli(cwd, ["watch", "tick", "--at", "2026-07-17T10:10:00.000Z"]);
    assert.deepEqual(firstTick.packets.map((packet) => packet.siteId), ["beta"]);
    assert.deepEqual(firstTick.skipped, [{ siteId: "alpha", reason: "already_ran" }]);
    assert.equal(firstTick.packets[0].rules[0].id, "beta-policy");
    assert.match(firstTick.packets[0].runDirectory.replace(/\\/g, "/"), /\.yls\/sites\/beta\/runs/);

    const duplicateTick = await runCli(cwd, ["watch", "tick", "--at", "2026-07-17T10:10:30.000Z"]);
    assert.equal(duplicateTick.packets.length, 0);
    assert.deepEqual(duplicateTick.skipped.map((entry) => entry.reason), ["already_ran", "already_ran"]);

    alpha.update({ title: "Alpha changed", h1: "A materially different promise", status: 503, extra: true });
    const changed = await runCli(cwd, ["watch", "run", "--site", "alpha", "--at", "2026-07-17T10:11:00.000Z"]);
    const delta = changed.packets[0].delta;
    assert.equal(delta.baseline, false);
    assert.deepEqual(delta.addedPaths, ["/extra"]);
    assert.deepEqual(delta.titleChanges.map((item) => item.path), ["/"]);
    assert.deepEqual(delta.h1Changes.map((item) => item.path), ["/"]);
    assert.deepEqual(delta.statusChanges, [{ path: "/", before: 200, after: 503 }]);
    assert.ok(delta.addedFindingRules.includes("navigation.http_error"));

    const originalBetaChannel = betaConfig.browser.channel;
    betaConfig.browser.channel = "definitely-not-a-browser";
    await writeFile(join(cwd, betaConfigPath), stringify(betaConfig));
    const driftedList = await runCli(cwd, ["site", "list"]);
    assert.equal(driftedList.sites.find((site) => site.id === "beta").configConfirmed, false);
    const partial = await runCli(cwd, ["watch", "tick", "--at", "2026-07-17T10:15:00.000Z"], 1);
    assert.equal(partial.status, "partial_failure");
    assert.deepEqual(partial.packets.map((packet) => packet.siteId), ["alpha"]);
    assert.deepEqual(partial.failures.map((failure) => failure.siteId), ["beta"]);
    assert.match(partial.failures[0].error, /changed after human confirmation/);

    if (originalBetaChannel) betaConfig.browser.channel = originalBetaChannel;
    else delete betaConfig.browser.channel;
    betaConfig.watch.rules[0].instruction = "Report HTTP failures and title drift, but do not change code.";
    await writeFile(join(cwd, betaConfigPath), stringify(betaConfig));
    const betaReplacement = await propose(cwd, "beta", betaConfigPath, true);
    const betaReplacementAnswers = await answers(cwd, betaReplacement, "beta-replacement");
    await runCli(cwd, [
      "site", "confirm", "--proposal", betaReplacement.proposalPath, "--answers", betaReplacementAnswers,
    ]);
    const reconfirmedList = await runCli(cwd, ["site", "list"]);
    assert.equal(reconfirmedList.sites.find((site) => site.id === "beta").configConfirmed, true);
    const recovered = await runCli(cwd, ["watch", "tick", "--at", "2026-07-17T10:20:00.000Z"]);
    assert.equal(recovered.status, "completed");
    assert.deepEqual(recovered.packets.map((packet) => packet.siteId), ["alpha", "beta"]);

    const badRegistration = await runCli(cwd, [
      "watch", "register", "--site", "alpha", "--provider", "Bad Provider", "--external-id", "automation-1",
      "--max-silence-minutes", "2",
    ], 1);
    assert.match(badRegistration.message, /--provider/);
    const registration = await runCli(cwd, [
      "watch", "register", "--site", "alpha", "--provider", "test-agent", "--external-id", "automation-1",
      "--max-silence-minutes", "2",
    ]);
    assert.equal(registration.status, "registered");
    const registeredAt = new Date(registration.registration.registeredAt);
    const watchStatePath = join(cwd, ".yls", "watch-state.json");
    const failedState = JSON.parse(await readFile(watchStatePath, "utf8"));
    failedState.sites.alpha.lastAttemptAt = new Date(registeredAt.getTime() + 10_000).toISOString();
    failedState.sites.alpha.lastStatus = "failed";
    failedState.sites.alpha.lastError = "seeded scheduler failure";
    await writeFile(watchStatePath, JSON.stringify(failedState, null, 2));
    const failedHealth = await runCli(cwd, ["watch", "status", "--site", "alpha"], 1);
    assert.equal(failedHealth.sites[0].health, "failed");
    delete failedState.sites.alpha.lastAttemptAt;
    delete failedState.sites.alpha.lastStatus;
    delete failedState.sites.alpha.lastError;
    await writeFile(watchStatePath, JSON.stringify(failedState, null, 2));
    const beforeHeartbeat = new Date(registeredAt.getTime() + 30_000).toISOString();
    const pending = await runCli(cwd, ["watch", "status", "--site", "alpha", "--at", beforeHeartbeat], 1);
    assert.equal(pending.sites[0].health, "pending_first_run");

    const heartbeatAt = new Date(registeredAt.getTime() + 60_000).toISOString();
    await runCli(cwd, ["watch", "run", "--site", "alpha", "--at", heartbeatAt]);
    const healthyAt = new Date(registeredAt.getTime() + 120_000).toISOString();
    const healthy = await runCli(cwd, ["watch", "status", "--site", "alpha", "--at", healthyAt]);
    assert.equal(healthy.sites[0].health, "healthy");
    assert.equal(healthy.sites[0].heartbeatAgeMinutes, 1);
    const staleAt = new Date(registeredAt.getTime() + 240_000).toISOString();
    const stale = await runCli(cwd, ["watch", "status", "--site", "alpha", "--at", staleAt], 1);
    assert.equal(stale.sites[0].health, "stale");

    alphaConfig.watch.schedule = { naturalLanguage: "every two minutes", cron: "*/2 * * * *", timezone: "UTC" };
    await writeFile(join(cwd, alphaConfigPath), stringify(alphaConfig));
    const alphaReplacement = await propose(cwd, "alpha", alphaConfigPath, true);
    const alphaReplacementAnswers = await answers(cwd, alphaReplacement, "alpha-replacement");
    await runCli(cwd, [
      "site", "confirm", "--proposal", alphaReplacement.proposalPath, "--answers", alphaReplacementAnswers,
    ]);
    const changedSchedule = await runCli(cwd, ["watch", "status", "--site", "alpha"], 1);
    assert.equal(changedSchedule.sites[0].health, "schedule_changed");
    assert.equal((await runCli(cwd, ["watch", "unregister", "--site", "alpha"])).removed, true);
    const afterUnregister = await runCli(cwd, ["watch", "status", "--site", "alpha"], 1);
    assert.equal(afterUnregister.sites[0].health, "not_registered");

    assert.ok(await readFile(join(cwd, ".yls", "sites", "alpha", "issues.json"), "utf8"));
    assert.ok(await readFile(join(cwd, ".yls", "sites", "beta", "issues.json"), "utf8"));
  } finally {
    await Promise.allSettled([alpha.close(), beta.close()]);
    await rm(cwd, { recursive: true, force: true });
  }
});
