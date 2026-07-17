import { access, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parse, stringify } from "yaml";
import type {
  AnalyticsConfig,
  PageRole,
  WatchConfig,
  YlsConfig,
} from "./types.js";
import { parseCron, validateTimezone } from "./cron.js";
import { assertSafeRelativeDirectory, ensureDirectory } from "./utils.js";

const roles = new Set<PageRole>([
  "conversion",
  "acquisition",
  "documentation",
  "informational",
]);

export function defaultConfig(url: string, artifactDirectory = ".yls"): YlsConfig {
  const parsedUrl = new URL(url);
  if (!/^https?:$/.test(parsedUrl.protocol)) {
    throw new Error("site URL must use http or https");
  }

  return {
    schemaVersion: 1,
    site: {
      url: parsedUrl.origin,
      maxPages: 50,
      maxDepth: 3,
      delayMs: 75,
      navigationTimeoutMs: 15_000,
      respectRobots: true,
      stripQuery: true,
      include: ["/**"],
      exclude: ["/api/**", "/admin/**", "/auth/**"],
    },
    pages: [
      {
        match: ["/", "/pricing", "/features/**"],
        role: "conversion",
        goal: "primary_conversion",
      },
      { match: ["/blog/**"], role: "acquisition" },
      { match: ["/docs/**"], role: "documentation" },
      { match: ["/legal/**", "/privacy", "/terms"], role: "informational" },
    ],
    product: {},
    guardrails: {
      viewports: [
        { name: "desktop", width: 1440, height: 900 },
        { name: "mobile", width: 390, height: 844 },
      ],
      accessibilityImpacts: ["critical", "serious"],
      maxLcpMs: 2500,
      maxCls: 0.1,
    },
    browser: {
      channel: "chrome",
      headless: true,
      settleMs: 150,
    },
    analytics: {
      provider: "none",
      thresholds: {
        optimizeMinSessions: 1000,
        optimizeMinConversions: 100,
      },
    },
    artifacts: {
      directory: artifactDirectory,
      screenshots: true,
    },
  };
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}

function validateWatch(value: unknown): WatchConfig | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object") throw new Error("watch must be an object");
  const watch = value as Record<string, any>;
  const schedule = watch.schedule as Record<string, any>;
  if (!schedule || typeof schedule !== "object") throw new Error("watch.schedule is required");
  const cron = nonEmptyString(schedule.cron, "watch.schedule.cron");
  parseCron(cron);
  const timezone = validateTimezone(nonEmptyString(schedule.timezone, "watch.schedule.timezone"));
  const naturalLanguage = nonEmptyString(schedule.naturalLanguage, "watch.schedule.naturalLanguage");
  if (!Array.isArray(watch.rules) || watch.rules.length === 0) {
    throw new Error("watch.rules must contain at least one natural-language rule");
  }
  const seen = new Set<string>();
  const rules = watch.rules.map((rule: any, index: number) => {
    const id = nonEmptyString(rule?.id, `watch.rules[${index}].id`);
    if (!/^[a-z][a-z0-9-]{0,62}$/.test(id)) {
      throw new Error(`watch.rules[${index}].id must use lowercase letters, numbers, and hyphens`);
    }
    if (seen.has(id)) throw new Error(`watch rule id is duplicated: ${id}`);
    seen.add(id);
    const autonomy = String(rule?.autonomy ?? "");
    if (!["observe", "propose", "autofix_verified_defects"].includes(autonomy)) {
      throw new Error(`watch.rules[${index}].autonomy is invalid`);
    }
    return {
      id,
      instruction: nonEmptyString(rule?.instruction, `watch.rules[${index}].instruction`),
      autonomy: autonomy as WatchConfig["rules"][number]["autonomy"],
    };
  });
  return { enabled: watch.enabled !== false, schedule: { naturalLanguage, cron, timezone }, rules };
}

function positiveNumber(value: unknown, label: string, allowZero = false): number {
  if (typeof value !== "number" || !Number.isFinite(value) || (allowZero ? value < 0 : value <= 0)) {
    throw new Error(`${label} must be ${allowZero ? "a non-negative" : "a positive"} number`);
  }
  return value;
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${label} must be an array of strings`);
  }
  return value;
}

export function validateConfig(input: unknown): YlsConfig {
  if (!input || typeof input !== "object") throw new Error("configuration must be an object");
  const value = input as Record<string, any>;
  if (value.schemaVersion !== 1) throw new Error("schemaVersion must be 1");

  const parsedUrl = new URL(String(value.site?.url ?? ""));
  if (!/^https?:$/.test(parsedUrl.protocol)) throw new Error("site.url must use http or https");
  assertSafeRelativeDirectory(String(value.artifacts?.directory ?? ""));

  const analytics = value.analytics as AnalyticsConfig;
  if (!analytics || !["none", "file", "posthog"].includes(analytics.provider)) {
    throw new Error("analytics.provider must be none, file, or posthog");
  }
  if (analytics.provider === "file" && !analytics.file?.path) {
    throw new Error("analytics.file.path is required for the file provider");
  }
  if (analytics.provider === "posthog") {
    const posthog = analytics.posthog;
    if (!posthog?.host || !posthog.projectId || !posthog.conversionEvent || !posthog.keyEnv) {
      throw new Error("analytics.posthog host, projectId, conversionEvent, and keyEnv are required");
    }
    const posthogUrl = new URL(posthog.host);
    if (!/^https?:$/.test(posthogUrl.protocol)) throw new Error("analytics.posthog.host must use http or https");
  }

  const pages = Array.isArray(value.pages) ? value.pages : [];
  for (const [index, rule] of pages.entries()) {
    stringArray(rule.match, `pages[${index}].match`);
    if (!roles.has(rule.role)) throw new Error(`pages[${index}].role is invalid`);
  }
  const watch = validateWatch(value.watch);

  const config: YlsConfig = {
    schemaVersion: 1,
    site: {
      url: parsedUrl.origin + (parsedUrl.pathname === "/" ? "" : parsedUrl.pathname.replace(/\/$/, "")),
      maxPages: positiveNumber(value.site.maxPages, "site.maxPages"),
      maxDepth: positiveNumber(value.site.maxDepth, "site.maxDepth", true),
      delayMs: positiveNumber(value.site.delayMs, "site.delayMs", true),
      navigationTimeoutMs: positiveNumber(value.site.navigationTimeoutMs, "site.navigationTimeoutMs"),
      respectRobots: value.site.respectRobots !== false,
      stripQuery: value.site.stripQuery !== false,
      include: stringArray(value.site.include ?? [], "site.include"),
      exclude: stringArray(value.site.exclude ?? [], "site.exclude"),
    },
    pages,
    product: value.product && typeof value.product === "object" ? value.product : {},
    guardrails: {
      viewports: Array.isArray(value.guardrails?.viewports)
        ? value.guardrails.viewports.map((viewport: any, index: number) => ({
            name: String(viewport.name || `viewport-${index}`),
            width: positiveNumber(viewport.width, `guardrails.viewports[${index}].width`),
            height: positiveNumber(viewport.height, `guardrails.viewports[${index}].height`),
          }))
        : [],
      accessibilityImpacts: stringArray(
        value.guardrails?.accessibilityImpacts ?? [],
        "guardrails.accessibilityImpacts",
      ),
      maxLcpMs: positiveNumber(value.guardrails?.maxLcpMs, "guardrails.maxLcpMs"),
      maxCls: positiveNumber(value.guardrails?.maxCls, "guardrails.maxCls", true),
    },
    browser: {
      ...(value.browser?.channel ? { channel: String(value.browser.channel) } : {}),
      headless: value.browser?.headless !== false,
      settleMs: positiveNumber(value.browser?.settleMs ?? 150, "browser.settleMs", true),
    },
    analytics: {
      ...analytics,
      thresholds: {
        optimizeMinSessions: positiveNumber(
          analytics.thresholds?.optimizeMinSessions,
          "analytics.thresholds.optimizeMinSessions",
          true,
        ),
        optimizeMinConversions: positiveNumber(
          analytics.thresholds?.optimizeMinConversions,
          "analytics.thresholds.optimizeMinConversions",
          true,
        ),
      },
    },
    artifacts: {
      directory: String(value.artifacts.directory),
      screenshots: value.artifacts.screenshots !== false,
    },
    ...(watch ? { watch } : {}),
  };

  if (config.guardrails.viewports.length === 0) {
    throw new Error("guardrails.viewports must contain at least one viewport");
  }
  return config;
}

export async function loadConfig(configPath = "yls.yaml", cwd = process.cwd()): Promise<{
  path: string;
  config: YlsConfig;
}> {
  const absolutePath = resolve(cwd, configPath);
  const raw = await readFile(absolutePath, "utf8");
  return { path: absolutePath, config: validateConfig(parse(raw)) };
}

export async function initializeProject(options: {
  url: string;
  configPath?: string;
  cwd?: string;
  force?: boolean;
}): Promise<{ configPath: string; artifactDirectory: string }> {
  const cwd = options.cwd ?? process.cwd();
  const configPath = resolve(cwd, options.configPath ?? "yls.yaml");
  if (!options.force) {
    try {
      await access(configPath);
      throw new Error(`${configPath} already exists; pass --force to replace it`);
    } catch (error) {
      if (error instanceof Error && error.message.includes("already exists")) throw error;
    }
  }

  const config = defaultConfig(options.url);
  await ensureDirectory(dirname(configPath));
  await writeFile(configPath, stringify(config, { lineWidth: 100 }), "utf8");
  const artifactDirectory = resolve(cwd, config.artifacts.directory);
  await ensureDirectory(artifactDirectory);
  await writeFile(
    resolve(artifactDirectory, ".gitignore"),
    "*\n!.gitignore\n",
    "utf8",
  );
  return { configPath, artifactDirectory };
}
