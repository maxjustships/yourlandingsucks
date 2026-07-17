import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { getAnalyticsSnapshot, classifyTraffic } from "./analytics.js";
import { auditPages } from "./audit.js";
import { launchBrowser } from "./browser.js";
import { discoverPublicPages, type DiscoveryResult } from "./crawler.js";
import { buildFindings, priorityQueue } from "./findings.js";
import type {
  AnalyticsSnapshot,
  RunArtifact,
  YlsConfig,
} from "./types.js";
import {
  createRunId,
  ensureDirectory,
  packageVersion,
  readJson,
  writeJson,
} from "./utils.js";

function safeConfig(config: YlsConfig): YlsConfig {
  return JSON.parse(JSON.stringify(config)) as YlsConfig;
}

function markdownEscape(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

export function renderBrief(run: RunArtifact): string {
  const priority = new Set(run.priorityQueue);
  const findings = run.findings.filter((finding) => priority.has(finding.id));
  const lines = [
    `# YourLandingSucks brief — ${run.runId}`,
    "",
    `- Mode: **${run.traffic.mode}** — ${run.traffic.rationale}`,
    `- Public routes: ${run.discovery.urls.length}`,
    `- Browser observations: ${run.pages.length}`,
    `- Findings retained: ${run.findings.length}`,
    `- Prioritized for the agent: ${findings.length}`,
    "",
    "The findings below are evidence packets, not instructions to change production. Change one causal variable at a time and verify a preview before deployment.",
    "",
  ];

  const productEntries = Object.entries(run.config.product).filter((entry) => Boolean(entry[1]));
  if (productEntries.length > 0) {
    lines.push(
      "## Product context supplied by the project",
      "",
      ...productEntries.map(([key, value]) => `- ${key}: ${markdownEscape(String(value))}`),
      "",
      "YLS does not interpret this context with an internal model. The user's coding agent uses it when judging heuristic findings.",
      "",
    );
  }

  if (findings.length === 0) {
    lines.push("No prioritized finding was produced.", "");
  }

  for (const [index, finding] of findings.entries()) {
    lines.push(
      `## ${index + 1}. ${finding.title}`,
      "",
      `- ID: \`${finding.id}\``,
      `- Evidence strength: \`${finding.kind}\``,
      `- Severity / confidence: \`${finding.severity}\` / \`${finding.confidence}\``,
      `- Pages: ${finding.affectedPages.map((path) => `\`${markdownEscape(path)}\``).join(", ")}`,
      "",
      finding.summary,
      "",
      `Suggested action: ${finding.suggestedAction}`,
      "",
      "Evidence:",
      "",
      ...finding.evidence.slice(0, 8).map(
        (item) => `- \`${markdownEscape(item.path)}\` / \`${item.viewport}\`: ${markdownEscape(item.summary)}`,
      ),
      "",
      "Verify:",
      "",
      ...finding.verification.map((item) => `- ${item}`),
      "",
    );
  }
  return `${lines.join("\n")}\n`;
}

function unavailableAnalytics(config: YlsConfig, error: unknown): AnalyticsSnapshot {
  return {
    provider: config.analytics.provider,
    available: false,
    sessions: 0,
    conversions: 0,
    conversionRate: null,
    note: `Analytics unavailable: ${error instanceof Error ? error.message : String(error)}`,
  };
}

export async function executeAuditRun(options: {
  config: YlsConfig;
  configPath: string;
  cwd?: string;
  command?: "run" | "verify";
  siteUrlOverride?: string;
  explicitPaths?: string[];
}): Promise<{ run: RunArtifact; runDirectory: string }> {
  const cwd = options.cwd ?? process.cwd();
  const startedAt = new Date().toISOString();
  const runId = createRunId();
  const command = options.command ?? "run";
  const config = safeConfig(options.config);
  if (options.siteUrlOverride) config.site.url = new URL(options.siteUrlOverride).origin;
  const artifactRoot = resolve(cwd, config.artifacts.directory);
  const runDirectory = resolve(artifactRoot, "runs", runId);
  await ensureDirectory(runDirectory);

  const browser = await launchBrowser(config.browser);
  let discovery: DiscoveryResult;
  try {
    if (options.explicitPaths) {
      const base = new URL(config.site.url);
      discovery = {
        urls: [...new Set(options.explicitPaths.map((path) => new URL(path, base).href))],
        skippedByMask: [],
        skippedByRobots: [],
        redirectedOffOrigin: [],
      };
    } else {
      discovery = await discoverPublicPages(browser, config.site, config.browser.settleMs);
    }
    const pages = await auditPages(browser, config, discovery.urls, runDirectory);
    let analytics: AnalyticsSnapshot;
    if (command === "verify") {
      analytics = {
        provider: "none",
        available: false,
        sessions: 0,
        conversions: 0,
        conversionRate: null,
        note: "Preview verification intentionally does not query production analytics.",
      };
    } else {
      try {
        analytics = await getAnalyticsSnapshot(config.analytics, config.site.url, dirname(options.configPath));
      } catch (error) {
        analytics = unavailableAnalytics(config, error);
      }
    }
    const traffic = classifyTraffic(analytics, config.analytics.thresholds);
    const findings = buildFindings(pages, config);
    const run: RunArtifact = {
      schemaVersion: 1,
      tool: { name: "yourlandingsucks", version: packageVersion() },
      runId,
      command,
      startedAt,
      completedAt: new Date().toISOString(),
      configPath: options.configPath,
      config,
      traffic: { ...traffic, snapshot: analytics },
      discovery,
      pages,
      findings,
      priorityQueue: priorityQueue(findings, 3),
    };
    await writeJson(resolve(runDirectory, "evidence.json"), run);
    await writeFile(resolve(runDirectory, "brief.md"), renderBrief(run), "utf8");
    return { run, runDirectory };
  } finally {
    await browser.close();
  }
}

export async function loadRun(
  runId: string,
  config: YlsConfig,
  cwd = process.cwd(),
): Promise<{ run: RunArtifact; runDirectory: string }> {
  const runDirectory = resolve(cwd, config.artifacts.directory, "runs", runId);
  return { run: await readJson<RunArtifact>(resolve(runDirectory, "evidence.json")), runDirectory };
}
