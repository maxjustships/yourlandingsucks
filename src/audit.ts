import { resolve } from "node:path";
import axe from "axe-core";
import type { Browser, Page } from "playwright";
import { enforceReadOnlyNetwork } from "./browser.js";
import { classifyPath } from "./glob.js";
import type {
  AccessibilityViolation,
  PageEvidence,
  PerformanceEvidence,
  ViewportConfig,
  YlsConfig,
} from "./types.js";
import { ensureDirectory, slugForPath } from "./utils.js";

interface RawAxeViolation {
  id: string;
  impact: string | null;
  help: string;
  helpUrl: string;
  nodes: Array<{ target: string[] }>;
}

async function installPerformanceObservers(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const state = { cls: 0, lcp: 0 };
    Object.defineProperty(window, "__ylsMetrics", {
      configurable: true,
      enumerable: false,
      value: state,
      writable: false,
    });
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as Array<PerformanceEntry & { hadRecentInput?: boolean; value?: number }>) {
          if (!entry.hadRecentInput) state.cls += entry.value ?? 0;
        }
      }).observe({ type: "layout-shift", buffered: true });
    } catch {
      // Unsupported metric stays at zero and remains explicitly synthetic.
    }
    try {
      new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const last = entries.at(-1);
        if (last) state.lcp = last.startTime;
      }).observe({ type: "largest-contentful-paint", buffered: true });
    } catch {
      // Unsupported metric stays at zero.
    }
  });
}

async function collectPerformance(page: Page): Promise<PerformanceEvidence> {
  return page.evaluate(() => {
    const state = (window as unknown as { __ylsMetrics?: { cls: number; lcp: number } }).__ylsMetrics;
    const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
    const transferBytes =
      (navigation?.transferSize ?? 0) + resources.reduce((total, resource) => total + (resource.transferSize || 0), 0);
    return {
      lcpMs: state?.lcp ? Math.round(state.lcp) : null,
      cls: Number((state?.cls ?? 0).toFixed(4)),
      domContentLoadedMs: navigation ? Math.round(navigation.domContentLoadedEventEnd) : null,
      loadMs: navigation ? Math.round(navigation.loadEventEnd) : null,
      transferBytes,
      resourceCount: resources.length,
    };
  });
}

async function inspectDom(page: Page): Promise<{
  title: string;
  h1: string[];
  forms: PageEvidence["forms"];
  cta: PageEvidence["cta"];
  horizontalOverflowPx: number;
}> {
  return page.evaluate(() => {
    const controls = [...document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
      "input:not([type=hidden]), select, textarea",
    )];
    const isLabelled = (control: HTMLElement): boolean => {
      const id = control.getAttribute("id");
      return Boolean(
        control.getAttribute("aria-label")?.trim() ||
          control.getAttribute("aria-labelledby")?.trim() ||
          control.closest("label") ||
          (id && document.querySelector(`label[for=${JSON.stringify(id)}]`)),
      );
    };
    const forms = [...document.querySelectorAll<HTMLFormElement>("form")];
    const candidates = [...document.querySelectorAll<HTMLElement>(
      "[data-yls-primary-cta], a[href], button, input[type=submit]",
    )];
    const preferred = candidates.find((element) => element.hasAttribute("data-yls-primary-cta"));
    const textPattern = /get started|sign up|start|try|buy|join|connect|book|demo|contact|subscribe|create|launch/i;
    const cta = preferred ?? candidates.find((element) => textPattern.test(
      element instanceof HTMLInputElement ? element.value : element.textContent ?? "",
    ));
    let ctaEvidence: PageEvidence["cta"] = { found: false };
    if (cta) {
      const rect = cta.getBoundingClientRect();
      const style = getComputedStyle(cta);
      const visible =
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity || "1") > 0 &&
        rect.width > 0 &&
        rect.height > 0;
      ctaEvidence = {
        found: true,
        text: (cta instanceof HTMLInputElement ? cta.value : cta.textContent ?? "").trim().slice(0, 160),
        tag: cta.tagName.toLowerCase(),
        top: Math.round(rect.top),
        bottom: Math.round(rect.bottom),
        visible,
        withinFirstViewport: visible && rect.top < window.innerHeight && rect.bottom > 0,
      };
    }
    return {
      title: document.title.trim(),
      h1: [...document.querySelectorAll("h1")].map((heading) => heading.textContent?.trim() ?? "").filter(Boolean),
      forms: {
        controls: controls.length,
        unlabeledControls: controls.filter((control) => !isLabelled(control)).length,
        methods: [...new Set(forms.map((form) => (form.method || "get").toLowerCase()))],
        actions: [...new Set(forms.map((form) => form.action))],
      },
      cta: ctaEvidence,
      horizontalOverflowPx: Math.max(0, Math.round(document.documentElement.scrollWidth - window.innerWidth)),
    };
  });
}

async function runAxe(page: Page, impacts: string[]): Promise<AccessibilityViolation[]> {
  await page.addScriptTag({ content: axe.source });
  const violations = await page.evaluate(async () => {
    const axeApi = (window as unknown as { axe: { run: (root: Document) => Promise<{ violations: RawAxeViolation[] }> } }).axe;
    return (await axeApi.run(document)).violations;
  });
  return violations
    .filter((violation) => !violation.impact || impacts.includes(violation.impact))
    .map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      helpUrl: violation.helpUrl,
      nodeCount: violation.nodes.length,
      targets: violation.nodes.flatMap((node) => node.target).slice(0, 20),
    }));
}

async function auditOne(
  browser: Browser,
  config: YlsConfig,
  url: string,
  viewport: ViewportConfig,
  runDirectory: string,
): Promise<PageEvidence> {
  const target = new URL(url);
  const classification = classifyPath(target.pathname, config.pages);
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    serviceWorkers: "block",
    reducedMotion: "reduce",
  });
  await enforceReadOnlyNetwork(context);
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text().slice(0, 1000));
  });
  page.on("pageerror", (error) => pageErrors.push(error.message.slice(0, 1000)));
  page.on("requestfailed", (request) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method().toUpperCase())) return;
    failedRequests.push(`${request.method()} ${request.url()} (${request.failure()?.errorText ?? "failed"})`);
  });
  await installPerformanceObservers(page);

  let status: number | null = null;
  let finalUrl: string | undefined;
  let redirectedOffOrigin = false;
  try {
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: config.site.navigationTimeoutMs,
    });
    status = response?.status() ?? null;
    finalUrl = page.url();
    redirectedOffOrigin = new URL(finalUrl).origin !== new URL(config.site.url).origin;
    await page.waitForTimeout(config.browser.settleMs);
  } catch (error) {
    pageErrors.push(`Navigation failed: ${error instanceof Error ? error.message : String(error)}`.slice(0, 1000));
  }

  let title = "";
  let h1: string[] = [];
  let forms: PageEvidence["forms"] = { controls: 0, unlabeledControls: 0, methods: [], actions: [] };
  let cta: PageEvidence["cta"] = { found: false };
  let horizontalOverflowPx = 0;
  let accessibility: AccessibilityViolation[] = [];
  let performance: PerformanceEvidence = {
    lcpMs: null,
    cls: 0,
    domContentLoadedMs: null,
    loadMs: null,
    transferBytes: 0,
    resourceCount: 0,
  };
  let screenshot: string | undefined;

  if (!redirectedOffOrigin && page.url() !== "about:blank") {
    try {
      const dom = await inspectDom(page);
      title = dom.title;
      h1 = dom.h1;
      forms = dom.forms;
      cta = dom.cta;
      horizontalOverflowPx = dom.horizontalOverflowPx;
      performance = await collectPerformance(page);
      accessibility = await runAxe(page, config.guardrails.accessibilityImpacts);
      if (config.artifacts.screenshots) {
        const screenshotName = `${slugForPath(target.pathname)}--${viewport.name}.png`;
        const screenshotDirectory = resolve(runDirectory, "screenshots");
        await ensureDirectory(screenshotDirectory);
        await page.screenshot({ path: resolve(screenshotDirectory, screenshotName), fullPage: true });
        screenshot = `screenshots/${screenshotName}`;
      }
    } catch (error) {
      pageErrors.push(`Inspection failed: ${error instanceof Error ? error.message : String(error)}`.slice(0, 1000));
    }
  }

  await context.close();
  return {
    url,
    path: target.pathname,
    ...classification,
    viewport,
    ...(finalUrl ? { finalUrl } : {}),
    status,
    redirectedOffOrigin,
    title,
    h1,
    consoleErrors: [...new Set(consoleErrors)],
    pageErrors: [...new Set(pageErrors)],
    failedRequests: [...new Set(failedRequests)],
    accessibility,
    forms,
    cta,
    horizontalOverflowPx,
    performance,
    ...(screenshot ? { screenshot } : {}),
  };
}

export async function auditPages(
  browser: Browser,
  config: YlsConfig,
  urls: string[],
  runDirectory: string,
): Promise<PageEvidence[]> {
  const pages: PageEvidence[] = [];
  for (const url of urls) {
    for (const viewport of config.guardrails.viewports) {
      pages.push(await auditOne(browser, config, url, viewport, runDirectory));
    }
  }
  return pages;
}
