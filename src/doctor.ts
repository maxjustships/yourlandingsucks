import { getAnalyticsSnapshot } from "./analytics.js";
import { launchBrowser } from "./browser.js";
import type { DoctorCheck, DoctorResult, YlsConfig } from "./types.js";

export function browserFailureCheck(error: unknown): DoctorCheck {
  return {
    name: "browser",
    status: "fail",
    code: "browser_unavailable",
    message: error instanceof Error ? error.message : String(error),
    remediation: {
      requiresConfirmation: true,
      command: "npx",
      args: ["--no-install", "playwright", "install", "chromium"],
      reason: "A compatible local Chrome or Playwright Chromium executable is required for browser evidence.",
    },
  };
}

async function connectivityCheck(config: YlsConfig): Promise<DoctorCheck> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.site.navigationTimeoutMs);
  try {
    const response = await fetch(config.site.url, { method: "GET", redirect: "manual", signal: controller.signal });
    if (response.status >= 400) {
      return { name: "target", status: "fail", message: `Target returned HTTP ${response.status}` };
    }
    const location = response.headers.get("location");
    if (location && new URL(location, config.site.url).origin !== new URL(config.site.url).origin) {
      return { name: "target", status: "fail", message: "Target redirects outside the configured origin" };
    }
    return { name: "target", status: "pass", message: `Target reachable with HTTP ${response.status}` };
  } catch (error) {
    return { name: "target", status: "fail", message: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timeout);
  }
}

export async function runDoctor(
  config: YlsConfig,
  configDirectory: string,
  dependencies: { launchBrowser?: typeof launchBrowser } = {},
): Promise<DoctorResult> {
  const checks: DoctorCheck[] = [
    { name: "config", status: "pass", message: "Configuration schema is valid" },
    await connectivityCheck(config),
  ];
  try {
    const browser = await (dependencies.launchBrowser ?? launchBrowser)(config.browser);
    await browser.close();
    checks.push({ name: "browser", status: "pass", message: "Playwright browser launched successfully" });
  } catch (error) {
    checks.push(browserFailureCheck(error));
  }
  try {
    const snapshot = await getAnalyticsSnapshot(config.analytics, config.site.url, configDirectory);
    checks.push({
      name: "analytics",
      status: snapshot.available ? "pass" : "warn",
      message: snapshot.note ?? `${snapshot.sessions} sessions and ${snapshot.conversions} conversions available`,
    });
  } catch (error) {
    checks.push({ name: "analytics", status: "fail", message: error instanceof Error ? error.message : String(error) });
  }
  return { status: checks.some((check) => check.status === "fail") ? "failed" : "passed", checks };
}
