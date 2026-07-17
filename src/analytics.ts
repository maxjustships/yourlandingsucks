import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  AnalyticsConfig,
  AnalyticsSnapshot,
  AnalyticsThresholds,
  TrafficMode,
} from "./types.js";

export interface AnalyticsAdapter {
  snapshot(): Promise<AnalyticsSnapshot>;
}

function normalizeSnapshot(
  provider: AnalyticsConfig["provider"],
  value: Partial<AnalyticsSnapshot>,
): AnalyticsSnapshot {
  const sessions = Number(value.sessions ?? 0);
  const conversions = Number(value.conversions ?? 0);
  if (!Number.isFinite(sessions) || sessions < 0) throw new Error("analytics sessions must be non-negative");
  if (!Number.isFinite(conversions) || conversions < 0) throw new Error("analytics conversions must be non-negative");
  return {
    provider,
    available: value.available !== false,
    sessions,
    conversions,
    conversionRate: sessions > 0 ? conversions / sessions : null,
    ...(value.lookbackDays !== undefined ? { lookbackDays: Number(value.lookbackDays) } : {}),
    ...(value.note ? { note: String(value.note) } : {}),
  };
}

class NoneAdapter implements AnalyticsAdapter {
  async snapshot(): Promise<AnalyticsSnapshot> {
    return normalizeSnapshot("none", {
      available: false,
      note: "No analytics adapter configured.",
    });
  }
}

class FileAdapter implements AnalyticsAdapter {
  constructor(
    private readonly path: string,
    private readonly cwd: string,
  ) {}

  async snapshot(): Promise<AnalyticsSnapshot> {
    const value = JSON.parse(await readFile(resolve(this.cwd, this.path), "utf8")) as Partial<AnalyticsSnapshot>;
    return normalizeSnapshot("file", value);
  }
}

function hogqlString(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

class PostHogAdapter implements AnalyticsAdapter {
  constructor(
    private readonly config: NonNullable<AnalyticsConfig["posthog"]>,
    private readonly siteUrl: string,
  ) {}

  async snapshot(): Promise<AnalyticsSnapshot> {
    const key = process.env[this.config.keyEnv];
    if (!key) {
      throw new Error(`Missing PostHog credential in ${this.config.keyEnv}`);
    }

    const days = Math.max(1, Math.floor(this.config.lookbackDays));
    const site = new URL(this.siteUrl);
    const query = [
      "SELECT",
      "  uniqExact(properties.$session_id) AS sessions,",
      `  countIf(event = ${hogqlString(this.config.conversionEvent)}) AS conversions`,
      "FROM events",
      `WHERE timestamp >= now() - INTERVAL ${days} DAY`,
      `  AND startsWith(toString(properties.$current_url), ${hogqlString(site.origin)})`,
    ].join("\n");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(
        `${this.config.host.replace(/\/$/, "")}/api/projects/${encodeURIComponent(this.config.projectId)}/query/`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ query: { kind: "HogQLQuery", query } }),
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        throw new Error(`PostHog query failed with HTTP ${response.status}`);
      }
      const payload = (await response.json()) as { results?: unknown[][] };
      const row = payload.results?.[0];
      if (!row || row.length < 2) throw new Error("PostHog query returned no aggregate row");
      return normalizeSnapshot("posthog", {
        sessions: Number(row[0]),
        conversions: Number(row[1]),
        lookbackDays: days,
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createAnalyticsAdapter(
  config: AnalyticsConfig,
  siteUrl: string,
  cwd = process.cwd(),
): AnalyticsAdapter {
  if (config.provider === "none") return new NoneAdapter();
  if (config.provider === "file") return new FileAdapter(config.file!.path, cwd);
  return new PostHogAdapter(config.posthog!, siteUrl);
}

export async function getAnalyticsSnapshot(
  config: AnalyticsConfig,
  siteUrl: string,
  cwd = process.cwd(),
): Promise<AnalyticsSnapshot> {
  return createAnalyticsAdapter(config, siteUrl, cwd).snapshot();
}

export function classifyTraffic(
  snapshot: AnalyticsSnapshot,
  thresholds: AnalyticsThresholds,
): { mode: TrafficMode; rationale: string } {
  if (!snapshot.available || snapshot.sessions <= 0) {
    return {
      mode: "ready",
      rationale: "No usable traffic snapshot is available; use deterministic readiness checks.",
    };
  }
  if (
    snapshot.sessions < thresholds.optimizeMinSessions ||
    snapshot.conversions < thresholds.optimizeMinConversions
  ) {
    return {
      mode: "listen",
      rationale: `Behavioral evidence exists, but configured optimize thresholds (${thresholds.optimizeMinSessions} sessions and ${thresholds.optimizeMinConversions} conversions) are not both met.`,
    };
  }
  return {
    mode: "optimize",
    rationale: "Configured traffic and conversion readiness thresholds are met; validate statistical power per experiment.",
  };
}
