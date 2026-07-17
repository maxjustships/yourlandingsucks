import type { Browser } from "playwright";
import { enforceReadOnlyNetwork } from "./browser.js";
import { isPathIncluded } from "./glob.js";
import type { SiteConfig } from "./types.js";
import { delay } from "./utils.js";

export interface DiscoveryResult {
  urls: string[];
  skippedByMask: string[];
  skippedByRobots: string[];
  redirectedOffOrigin: string[];
}

interface RobotsRules {
  allow: string[];
  disallow: string[];
}

function decodeXml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export function canonicalizeUrl(raw: string, base: URL, stripQuery: boolean): URL | null {
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol) || url.origin !== base.origin) return null;
  url.hash = "";
  if (stripQuery) {
    url.search = "";
  } else {
    url.searchParams.sort();
  }
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
  return url;
}

export function parseRobots(text: string): RobotsRules {
  const rules: RobotsRules = { allow: [], disallow: [] };
  let applies = false;
  let sawRuleInGroup = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (key === "user-agent") {
      if (sawRuleInGroup) {
        applies = false;
        sawRuleInGroup = false;
      }
      if (value === "*") applies = true;
      continue;
    }
    if (key === "allow" || key === "disallow") {
      sawRuleInGroup = true;
      if (!applies || !value) continue;
      rules[key].push(value);
    }
  }
  return rules;
}

export function robotsAllows(path: string, rules: RobotsRules): boolean {
  const candidates = [
    ...rules.allow.map((rule) => ({ type: "allow" as const, rule })),
    ...rules.disallow.map((rule) => ({ type: "disallow" as const, rule })),
  ].filter(({ rule }) => path.startsWith(rule));
  if (candidates.length === 0) return true;
  candidates.sort((a, b) => b.rule.length - a.rule.length || (a.type === "allow" ? -1 : 1));
  return candidates[0]!.type === "allow";
}

async function fetchText(url: string, timeoutMs: number): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    return response.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function sitemapUrls(
  sitemapUrl: URL,
  base: URL,
  config: SiteConfig,
  seen = new Set<string>(),
): Promise<string[]> {
  if (seen.has(sitemapUrl.href) || seen.size >= 10) return [];
  seen.add(sitemapUrl.href);
  const xml = await fetchText(sitemapUrl.href, config.navigationTimeoutMs);
  if (!xml) return [];
  const locations = [...xml.matchAll(/<loc(?:\s[^>]*)?>([\s\S]*?)<\/loc>/gi)]
    .map((match) => decodeXml(match[1]!.trim()))
    .filter(Boolean);
  if (/<sitemapindex\b/i.test(xml)) {
    const nested: string[] = [];
    for (const location of locations) {
      const url = canonicalizeUrl(location, base, false);
      if (!url || !url.pathname.endsWith(".xml")) continue;
      nested.push(...(await sitemapUrls(url, base, config, seen)));
    }
    return nested;
  }
  return locations;
}

export async function discoverPublicPages(
  browser: Browser,
  config: SiteConfig,
  settleMs = 0,
): Promise<DiscoveryResult> {
  const base = new URL(config.url);
  const origin = base.origin;
  const result: DiscoveryResult = {
    urls: [],
    skippedByMask: [],
    skippedByRobots: [],
    redirectedOffOrigin: [],
  };

  let robots: RobotsRules = { allow: [], disallow: [] };
  if (config.respectRobots) {
    const text = await fetchText(new URL("/robots.txt", origin).href, config.navigationTimeoutMs);
    if (text) robots = parseRobots(text);
  }

  const initial = [config.url];
  const sitemap = await sitemapUrls(new URL("/sitemap.xml", origin), base, config);
  initial.push(...sitemap);

  const queue: Array<{ url: URL; depth: number }> = [];
  const queued = new Set<string>();
  const visited = new Set<string>();
  const skippedMasks = new Set<string>();
  const skippedRobots = new Set<string>();

  const enqueue = (raw: string, depth: number): void => {
    const url = canonicalizeUrl(raw, base, config.stripQuery);
    if (!url || queued.has(url.href) || visited.has(url.href)) return;
    if (!isPathIncluded(url.pathname, config.include, config.exclude)) {
      skippedMasks.add(url.pathname);
      return;
    }
    if (config.respectRobots && !robotsAllows(url.pathname, robots)) {
      skippedRobots.add(url.pathname);
      return;
    }
    queued.add(url.href);
    queue.push({ url, depth });
  };

  for (const url of initial) enqueue(url, 0);

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    serviceWorkers: "block",
  });
  await enforceReadOnlyNetwork(context);
  try {
    while (queue.length > 0 && result.urls.length < config.maxPages) {
      const entry = queue.shift()!;
      queued.delete(entry.url.href);
      if (visited.has(entry.url.href)) continue;
      visited.add(entry.url.href);
      result.urls.push(entry.url.href);

      const page = await context.newPage();
      try {
        await page.goto(entry.url.href, {
          waitUntil: "domcontentloaded",
          timeout: config.navigationTimeoutMs,
        });
        if (settleMs > 0) await page.waitForTimeout(settleMs);
        const finalUrl = new URL(page.url());
        if (finalUrl.origin !== origin) {
          result.redirectedOffOrigin.push(entry.url.href);
          continue;
        }
        if (entry.depth >= config.maxDepth) continue;
        const hrefs = await page.locator("a[href]").evaluateAll((nodes) =>
          nodes.map((node) => (node as HTMLAnchorElement).href),
        );
        for (const href of hrefs) enqueue(href, entry.depth + 1);
      } catch {
        // Navigation failures are retained as auditable URLs and become findings later.
      } finally {
        await page.close();
      }
      await delay(config.delayMs);
    }
  } finally {
    await context.close();
  }

  result.skippedByMask = [...skippedMasks].sort();
  result.skippedByRobots = [...skippedRobots].sort();
  result.redirectedOffOrigin = [...new Set(result.redirectedOffOrigin)].sort();
  return result;
}
