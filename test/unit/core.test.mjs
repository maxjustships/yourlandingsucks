import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parse } from "yaml";
import {
  aggregateFeedback,
  canonicalizeUrl,
  classifyPath,
  classifyTraffic,
  cronMatches,
  createAnalyticsAdapter,
  defaultConfig,
  draftSite,
  initializeProject,
  isPathIncluded,
  parseRobots,
  robotsAllows,
  scheduledMinuteKey,
  validateConfig,
} from "../../dist/index.js";

test("glob masks and page roles are deterministic", () => {
  assert.equal(isPathIncluded("/pricing", ["/**"], ["/admin/**"]), true);
  assert.equal(isPathIncluded("/admin/secret", ["/**"], ["/admin/**"]), false);
  assert.equal(isPathIncluded("/docs/start", ["/docs/**"], []), true);
  assert.equal(isPathIncluded("/docs", ["/docs/**"], []), true);
  assert.equal(isPathIncluded("/admin", ["/**"], ["/admin/**"]), false);
  assert.deepEqual(
    classifyPath("/docs/start", [{ match: ["/docs/**"], role: "documentation", goal: "find_answer" }]),
    { role: "documentation", goal: "find_answer" },
  );
});

test("robots uses the longest matching allow/disallow rule", () => {
  const rules = parseRobots("User-agent: *\nDisallow: /private\nAllow: /private/public\n");
  assert.equal(robotsAllows("/private", rules), false);
  assert.equal(robotsAllows("/private/secret", rules), false);
  assert.equal(robotsAllows("/private/public/page", rules), true);
  assert.equal(robotsAllows("/docs", rules), true);
});

test("URL canonicalization stays same-origin and removes duplicate syntax", () => {
  const base = new URL("https://example.com");
  assert.equal(canonicalizeUrl("/pricing/?b=2#offer", base, true)?.href, "https://example.com/pricing");
  assert.equal(canonicalizeUrl("https://other.example/path", base, true), null);
});

test("cron matching supports timezone, steps, ranges, Sunday 7, and duplicate-minute keys", () => {
  const friday = new Date("2026-07-17T07:30:00.000Z");
  assert.equal(cronMatches("*/15 9-17 * * 1-5", friday, "Asia/Yekaterinburg"), true);
  assert.equal(cronMatches("31 12 * * 1-5", friday, "Asia/Yekaterinburg"), false);
  assert.equal(cronMatches("0 5 * * 7", new Date("2026-07-19T00:00:00.000Z"), "Asia/Yekaterinburg"), true);
  assert.equal(scheduledMinuteKey(friday, "Asia/Yekaterinburg"), "2026-07-17T12:30@Asia/Yekaterinburg");
  const firstFallback = scheduledMinuteKey(new Date("2026-11-01T05:30:00.000Z"), "America/New_York");
  const secondFallback = scheduledMinuteKey(new Date("2026-11-01T06:30:00.000Z"), "America/New_York");
  assert.equal(firstFallback, secondFallback, "repeated DST wall-clock minute should run once");
  assert.equal(cronMatches("0 0 17 * 1", new Date("2026-07-17T00:00:00.000Z"), "UTC"), true, "restricted DOM/DOW use cron OR semantics");
  assert.throws(() => cronMatches("* * *", friday, "UTC"), /exactly five fields/);
  assert.throws(() => cronMatches("*/0 * * * *", friday, "UTC"), /step must be positive/);
  assert.throws(() => cronMatches("* * * * *", friday, "Mars/Olympus"), /timezone is invalid/);
});

test("traffic mode is explicit and threshold-driven", () => {
  const thresholds = { optimizeMinSessions: 1000, optimizeMinConversions: 100 };
  assert.equal(classifyTraffic({ provider: "none", available: false, sessions: 0, conversions: 0, conversionRate: null }, thresholds).mode, "ready");
  assert.equal(classifyTraffic({ provider: "file", available: true, sessions: 40, conversions: 3, conversionRate: 0.075 }, thresholds).mode, "listen");
  assert.equal(classifyTraffic({ provider: "file", available: true, sessions: 1200, conversions: 110, conversionRate: 110 / 1200 }, thresholds).mode, "optimize");
});

test("init writes only the explicit config and private artifact directory", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "yls-init-"));
  try {
    await initializeProject({ url: "https://example.com", cwd });
    assert.deepEqual((await readdir(cwd)).sort(), [".yls", "yls.yaml"]);
    assert.equal(await readFile(join(cwd, ".yls", ".gitignore"), "utf8"), "*\n!.gitignore\n");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("multi-site draft creates a tracked config and an unconfirmed local proposal", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "yls-site-draft-"));
  try {
    const result = await draftSite({ siteId: "marketing", url: "https://example.com", cwd, agent: "test-agent" });
    const config = parse(await readFile(result.configPath, "utf8"));
    const proposal = parse(await readFile(result.proposalPath, "utf8"));
    assert.equal(config.artifacts.directory, ".yls/sites/marketing");
    assert.equal(config.watch.rules[0].autonomy, "observe");
    assert.equal(proposal.agent, "test-agent");
    assert.equal(proposal.questions.length, 3);
    assert.equal(await readFile(join(cwd, ".yls", ".gitignore"), "utf8"), "*\n!.gitignore\n");
    await assert.rejects(() => draftSite({ siteId: "../escape", url: "https://example.com", cwd }), /siteId/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("configuration rejects artifact traversal", () => {
  const config = defaultConfig("https://example.com");
  config.artifacts.directory = "../escape";
  assert.throws(() => validateConfig(config), /must stay inside/);
});

test("watch configuration requires explicit natural-language rules and safe autonomy", () => {
  const config = defaultConfig("https://example.com", ".yls/sites/marketing");
  config.watch = {
    enabled: true,
    schedule: { naturalLanguage: "every weekday at noon", cron: "0 12 * * 1-5", timezone: "UTC" },
    rules: [{ id: "headline-drift", instruction: "Tell me if the main promise changes.", autonomy: "observe" }],
  };
  assert.deepEqual(validateConfig(config).watch, config.watch);
  config.watch.rules[0].autonomy = "autofix_verified_defects";
  assert.equal(validateConfig(config).watch.rules[0].autonomy, "autofix_verified_defects");
  config.watch.rules.push({ ...config.watch.rules[0] });
  assert.throws(() => validateConfig(config), /duplicated/);
});

test("file analytics adapter reads only the explicitly configured snapshot", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "yls-analytics-"));
  try {
    await writeFile(join(cwd, "snapshot.json"), JSON.stringify({ sessions: 25, conversions: 2 }));
    const config = defaultConfig("https://example.com").analytics;
    config.provider = "file";
    config.file = { path: "snapshot.json" };
    const snapshot = await createAnalyticsAdapter(config, "https://example.com", cwd).snapshot();
    assert.equal(snapshot.sessions, 25);
    assert.equal(snapshot.conversions, 2);
    assert.equal(snapshot.conversionRate, 0.08);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("PostHog adapter uses bearer auth and parses aggregate query results", async () => {
  let observedAuth = "";
  let observedBody = "";
  const server = createServer(async (request, response) => {
    observedAuth = String(request.headers.authorization ?? "");
    for await (const chunk of request) observedBody += chunk;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ results: [[1500, 150]] }));
  });
  await new Promise((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("mock did not bind");
  process.env.YLS_TEST_POSTHOG_KEY = "phx_test";
  try {
    const config = defaultConfig("https://example.com").analytics;
    config.provider = "posthog";
    config.posthog = {
      host: `http://127.0.0.1:${address.port}`,
      projectId: "42",
      conversionEvent: "signup_completed",
      lookbackDays: 14,
      keyEnv: "YLS_TEST_POSTHOG_KEY",
    };
    const snapshot = await createAnalyticsAdapter(config, "https://example.com").snapshot();
    assert.equal(observedAuth, "Bearer phx_test");
    assert.match(observedBody, /HogQLQuery/);
    assert.match(observedBody, /signup_completed/);
    assert.equal(snapshot.sessions, 1500);
    assert.equal(snapshot.conversions, 150);
  } finally {
    delete process.env.YLS_TEST_POSTHOG_KEY;
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
});

test("runtime dependencies contain no model provider SDK", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
  const dependencies = Object.keys(packageJson.dependencies ?? {}).join(" ").toLowerCase();
  assert.doesNotMatch(dependencies, /openai|anthropic|gemini|mistral|cohere/);
});

test("README install is one human copy-paste prompt with no blanks to fill", async () => {
  const readme = await readFile(new URL("../../README.md", import.meta.url), "utf8");
  const install = readme.match(/## Install\n([\s\S]*?)(?=\n## )/)?.[1];
  assert.ok(install, "README must contain an Install section");
  for (const required of [
    "git+ssh://git@github.com/maxjustships/yourlandingsucks.git#main",
    "node_modules/yourlandingsucks/skills/yourlandingsucks/SKILL.md",
    "discover every public website it owns",
    "ask me only for decisions that cannot be safely inferred",
    "Do not activate any site until I confirm its proposal",
  ]) {
    assert.match(install, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(install, /YLS_SOURCE|PUBLIC_SITES|AGENT_NAME|<[^>\n]+>|\breplace\b/i);
});

test("bundled Agent Skill owns onboarding, watch, and issue instructions", async () => {
  const skillRoot = new URL("../../skills/yourlandingsucks/", import.meta.url);
  const contents = [
    await readFile(new URL("SKILL.md", skillRoot), "utf8"),
    await readFile(new URL("references/onboarding.md", skillRoot), "utf8"),
    await readFile(new URL("references/operations.md", skillRoot), "utf8"),
    await readFile(new URL("references/watch-and-feedback.md", skillRoot), "utf8"),
  ].join("\n");
  for (const required of [
    "yls site draft",
    "yls site propose",
    "yls site confirm",
    "yls watch tick",
    "yls issue verify",
    "human confirms its proposal",
    "Never export, upload, commit, or push",
  ]) {
    assert.match(contents, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  }
});

test("sanitized cross-project feedback aggregates by rule and deduplicates runs", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "yls-feedback-aggregate-"));
  try {
    const first = {
      schemaVersion: 1,
      runId: "run-a",
      findings: [{ id: "finding-a", rule: "forms.unlabelled_control" }],
      events: [
        { findingId: "finding-a", decision: "accepted", reasonCode: "accepted" },
        { findingId: "finding-a", decision: "verification_passed", reasonCode: "accepted" },
      ],
    };
    const second = {
      schemaVersion: 1,
      runId: "run-b",
      findings: [{ id: "finding-b", rule: "forms.unlabelled_control" }],
      events: [
        { findingId: "finding-b", decision: "false_positive", reasonCode: "false_positive" },
        { findingId: "finding-b", decision: "verification_failed", reasonCode: "verification_failed" },
        { findingId: "finding-b", decision: "reopened", reasonCode: "finding_recurred" },
      ],
    };
    await writeFile(join(cwd, "a.json"), JSON.stringify(first));
    await writeFile(join(cwd, "b.json"), JSON.stringify(second));
    await writeFile(join(cwd, "duplicate.json"), JSON.stringify(second));

    const aggregate = await aggregateFeedback({ input: cwd, output: "summary.json", cwd });
    assert.equal(aggregate.exportsRead, 3);
    assert.equal(aggregate.uniqueRuns, 2);
    assert.equal(aggregate.duplicateRunsSkipped, 1);
    assert.equal(aggregate.rules.length, 1);
    assert.equal(aggregate.rules[0].falsePositiveRate, 0.5);
    assert.equal(aggregate.rules[0].verificationFailureRate, 0.5);
    assert.equal(aggregate.rules[0].recurrenceCount, 1);
    assert.equal(aggregate.rules[0].suggestedMetaAction, "tighten_detection");
    assert.deepEqual(JSON.parse(await readFile(join(cwd, "summary.json"), "utf8")), aggregate);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
