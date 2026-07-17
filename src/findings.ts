import type {
  Confidence,
  Finding,
  FindingEvidence,
  FindingKind,
  PageEvidence,
  Severity,
  YlsConfig,
} from "./types.js";
import { stableHash } from "./utils.js";

interface Candidate {
  rule: string;
  kind: FindingKind;
  severity: Severity;
  confidence: Confidence;
  title: string;
  summary: string;
  evidence: FindingEvidence;
  suggestedAction: string;
  verification: string[];
}

function evidence(page: PageEvidence, summary: string, details?: Record<string, unknown>): FindingEvidence {
  return {
    path: page.path,
    viewport: page.viewport.name,
    summary,
    ...(details ? { details } : {}),
    ...(page.screenshot ? { screenshot: page.screenshot } : {}),
  };
}

function candidate(
  page: PageEvidence,
  value: Omit<Candidate, "evidence"> & { evidenceSummary: string; details?: Record<string, unknown> },
): Candidate {
  const { evidenceSummary, details, ...rest } = value;
  return { ...rest, evidence: evidence(page, evidenceSummary, details) };
}

function candidatesForPage(page: PageEvidence, config: YlsConfig): Candidate[] {
  const values: Candidate[] = [];
  const add = (value: Omit<Candidate, "evidence"> & { evidenceSummary: string; details?: Record<string, unknown> }) =>
    values.push(candidate(page, value));

  if (page.redirectedOffOrigin) {
    add({
      rule: "navigation.off_origin_redirect",
      kind: "verified_defect",
      severity: "high",
      confidence: "high",
      title: "Page redirects outside the configured origin",
      summary: "The public route left the allowed origin and was not audited.",
      evidenceSummary: `Final URL: ${page.finalUrl ?? "unknown"}`,
      suggestedAction: "Confirm the redirect is intentional or keep the route on the configured origin.",
      verification: ["Route remains on the configured origin", "Page can be audited without cross-origin navigation"],
    });
    return values;
  }

  if (page.status === null) {
    add({
      rule: "navigation.failed",
      kind: "verified_defect",
      severity: "critical",
      confidence: "high",
      title: "Page navigation failed",
      summary: "The browser could not obtain an HTTP response for this public route.",
      evidenceSummary: page.pageErrors[0] ?? "No HTTP response",
      suggestedAction: "Restore a successful public response and rerun the audit.",
      verification: ["Navigation returns an HTTP response", "No browser navigation error is emitted"],
    });
  } else if (page.status >= 400) {
    add({
      rule: "navigation.http_error",
      kind: "verified_defect",
      severity: page.status >= 500 ? "critical" : "high",
      confidence: "high",
      title: "Public route returns an HTTP error",
      summary: "At least one discovered public route is not reachable successfully.",
      evidenceSummary: `HTTP ${page.status}`,
      details: { status: page.status },
      suggestedAction: "Fix or intentionally exclude the route from the public surface.",
      verification: ["Route returns a 2xx or intentional 3xx response"],
    });
  }

  if (page.pageErrors.length > 0) {
    add({
      rule: "runtime.page_error",
      kind: "verified_defect",
      severity: "high",
      confidence: "high",
      title: "Unhandled browser runtime error",
      summary: "The page emitted an unhandled JavaScript or inspection error.",
      evidenceSummary: page.pageErrors.join(" | ").slice(0, 1000),
      details: { count: page.pageErrors.length },
      suggestedAction: "Reproduce and remove the runtime error before optimizing the page.",
      verification: ["No pageerror event is emitted", "The route remains interactive"],
    });
  }

  if (page.consoleErrors.length > 0) {
    add({
      rule: "runtime.console_error",
      kind: "verified_defect",
      severity: "medium",
      confidence: "high",
      title: "Console errors on a public page",
      summary: "The rendered page writes errors to the browser console.",
      evidenceSummary: page.consoleErrors.join(" | ").slice(0, 1000),
      details: { count: page.consoleErrors.length },
      suggestedAction: "Remove first-party console errors and explicitly suppress only understood third-party noise.",
      verification: ["No unexpected console error is emitted"],
    });
  }

  if (page.failedRequests.length > 0) {
    add({
      rule: "network.request_failed",
      kind: "verified_defect",
      severity: "medium",
      confidence: "high",
      title: "Page resources fail to load",
      summary: "One or more browser requests failed while rendering the page.",
      evidenceSummary: page.failedRequests.join(" | ").slice(0, 1000),
      details: { count: page.failedRequests.length },
      suggestedAction: "Fix, remove, or intentionally handle the failing resource request.",
      verification: ["No unexpected requestfailed event is emitted"],
    });
  }

  for (const violation of page.accessibility) {
    add({
      rule: `accessibility.${violation.id}`,
      kind: "verified_defect",
      severity: violation.impact === "critical" ? "critical" : "high",
      confidence: "high",
      title: violation.help,
      summary: `Automated accessibility rule ${violation.id} failed.`,
      evidenceSummary: `${violation.nodeCount} affected node(s): ${violation.targets.join(", ")}`,
      details: { impact: violation.impact, helpUrl: violation.helpUrl, nodeCount: violation.nodeCount },
      suggestedAction: `Fix the ${violation.id} violations without changing the intended user flow.`,
      verification: [`axe rule ${violation.id} has no ${violation.impact ?? "included"} violations`],
    });
  }

  if (page.forms.unlabeledControls > 0) {
    add({
      rule: "forms.unlabelled_control",
      kind: "verified_defect",
      severity: "high",
      confidence: "high",
      title: "Form controls lack accessible labels",
      summary: "Users and assistive technology cannot reliably identify every form input.",
      evidenceSummary: `${page.forms.unlabeledControls} of ${page.forms.controls} controls are unlabeled`,
      details: { unlabeled: page.forms.unlabeledControls, controls: page.forms.controls },
      suggestedAction: "Associate a visible label or an explicit accessible name with each control.",
      verification: ["Every non-hidden input, select, and textarea has an accessible name", "Form is not submitted during verification"],
    });
  }

  if (page.horizontalOverflowPx > 0) {
    add({
      rule: "layout.horizontal_overflow",
      kind: "verified_defect",
      severity: page.viewport.width <= 480 ? "high" : "medium",
      confidence: "high",
      title: "Viewport has horizontal overflow",
      summary: "Rendered content exceeds the configured viewport width.",
      evidenceSummary: `${page.horizontalOverflowPx}px overflow at ${page.viewport.width}px`,
      details: { overflowPx: page.horizontalOverflowPx, viewportWidth: page.viewport.width },
      suggestedAction: "Constrain the overflowing element without hiding required content.",
      verification: ["document scrollWidth does not exceed the viewport width"],
    });
  }

  if (!page.title && page.status !== null && page.status < 400) {
    add({
      rule: "content.missing_title",
      kind: "verified_defect",
      severity: "medium",
      confidence: "high",
      title: "Page has no document title",
      summary: "The public page does not expose a meaningful browser/document title.",
      evidenceSummary: "document.title is empty",
      suggestedAction: "Add a concise, route-specific document title.",
      verification: ["document.title is non-empty"],
    });
  }

  if (page.h1.length === 0 && page.status !== null && page.status < 400 && page.role !== "informational") {
    add({
      rule: "content.missing_h1",
      kind: "heuristic_risk",
      severity: "medium",
      confidence: "medium",
      title: "Page role has no primary heading",
      summary: "A conversion, acquisition, or documentation page has no rendered h1.",
      evidenceSummary: `Role ${page.role}; zero h1 elements`,
      suggestedAction: "Add one descriptive primary heading if it matches the visual and semantic hierarchy.",
      verification: ["Page exposes one clear primary heading", "Heading describes the configured page role"],
    });
  }

  if (page.h1.length > 1 && page.role !== "informational") {
    add({
      rule: "content.multiple_h1",
      kind: "heuristic_risk",
      severity: "low",
      confidence: "medium",
      title: "Page has multiple primary headings",
      summary: "The page hierarchy may make the primary message ambiguous.",
      evidenceSummary: `${page.h1.length} h1 elements`,
      suggestedAction: "Confirm the hierarchy intentionally has one dominant page heading.",
      verification: ["Heading hierarchy has one intentional primary message"],
    });
  }

  if (page.role === "conversion" && page.status !== null && page.status < 400) {
    if (!page.cta.found || !page.cta.visible) {
      add({
        rule: "conversion.primary_cta_missing",
        kind: "heuristic_risk",
        severity: "high",
        confidence: "medium",
        title: "No visible primary conversion action detected",
        summary: "The configured conversion page exposes no detectable visible primary CTA.",
        evidenceSummary: page.cta.found ? "CTA candidate exists but is not visible" : "No CTA candidate detected",
        suggestedAction: "Expose one primary action and mark it with data-yls-primary-cta when automatic detection is ambiguous.",
        verification: ["A visible primary CTA exists", "CTA matches the configured conversion goal"],
      });
    } else if (page.viewport.width <= 480 && !page.cta.withinFirstViewport) {
      add({
        rule: "conversion.primary_cta_below_fold",
        kind: "heuristic_risk",
        severity: "medium",
        confidence: "medium",
        title: "Primary CTA starts below the first mobile viewport",
        summary: "The primary action requires scrolling on the configured mobile viewport.",
        evidenceSummary: `CTA top ${page.cta.top}px; viewport height ${page.viewport.height}px`,
        details: { top: page.cta.top, viewportHeight: page.viewport.height, text: page.cta.text },
        suggestedAction: "Consider exposing the primary action earlier without obscuring the offer or accessibility.",
        verification: ["Primary CTA intersects the first mobile viewport", "No accessibility or layout regression"],
      });
    }
  }

  if (page.performance.lcpMs !== null && page.performance.lcpMs > config.guardrails.maxLcpMs) {
    add({
      rule: "performance.synthetic_lcp",
      kind: "heuristic_risk",
      severity: "medium",
      confidence: "medium",
      title: "Synthetic LCP exceeds the configured guardrail",
      summary: "A local browser observation suggests slow largest-content rendering; field data is required for causal claims.",
      evidenceSummary: `${page.performance.lcpMs}ms > ${config.guardrails.maxLcpMs}ms`,
      details: { observedMs: page.performance.lcpMs, limitMs: config.guardrails.maxLcpMs },
      suggestedAction: "Inspect the LCP element and validate improvements with both synthetic and field measurements.",
      verification: ["Synthetic LCP is within the configured guardrail", "Field performance does not regress"],
    });
  }

  if (page.performance.cls > config.guardrails.maxCls) {
    add({
      rule: "performance.synthetic_cls",
      kind: "heuristic_risk",
      severity: "medium",
      confidence: "medium",
      title: "Synthetic CLS exceeds the configured guardrail",
      summary: "The page visibly shifts during synthetic loading.",
      evidenceSummary: `${page.performance.cls} > ${config.guardrails.maxCls}`,
      details: { observed: page.performance.cls, limit: config.guardrails.maxCls },
      suggestedAction: "Reserve stable layout space and verify the shift source before shipping.",
      verification: ["Synthetic CLS is within the configured guardrail", "No content is hidden to mask the shift"],
    });
  }

  return values;
}

const severityWeight: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1 };
const kindWeight: Record<FindingKind, number> = {
  verified_defect: 4,
  behavior_signal: 3,
  experiment_result: 2,
  heuristic_risk: 1,
};

export function buildFindings(pages: PageEvidence[], config: YlsConfig): Finding[] {
  const groups = new Map<string, Candidate[]>();
  for (const page of pages) {
    for (const item of candidatesForPage(page, config)) {
      const key = `${item.rule}|${item.kind}|${item.title}`;
      const group = groups.get(key) ?? [];
      group.push(item);
      groups.set(key, group);
    }
  }

  const findings: Finding[] = [...groups.entries()].map(([fingerprint, group]) => {
    const first = group[0]!;
    return {
      id: `yls-${stableHash(fingerprint)}`,
      fingerprint,
      rule: first.rule,
      kind: first.kind,
      severity: first.severity,
      confidence: first.confidence,
      title: first.title,
      summary: first.summary,
      affectedPages: [...new Set(group.map((item) => item.evidence.path))].sort(),
      evidence: group.map((item) => item.evidence),
      suggestedAction: first.suggestedAction,
      verification: first.verification,
    };
  });

  return findings.sort((a, b) =>
    severityWeight[b.severity] - severityWeight[a.severity] ||
    kindWeight[b.kind] - kindWeight[a.kind] ||
    b.affectedPages.length - a.affectedPages.length ||
    a.rule.localeCompare(b.rule),
  );
}

export function priorityQueue(findings: Finding[], limit = 3): string[] {
  return findings.slice(0, Math.max(0, limit)).map((finding) => finding.id);
}
