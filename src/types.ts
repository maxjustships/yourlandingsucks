export type Severity = "critical" | "high" | "medium" | "low";
export type Confidence = "high" | "medium" | "low";
export type FindingKind =
  | "verified_defect"
  | "heuristic_risk"
  | "behavior_signal"
  | "experiment_result";
export type PageRole =
  | "conversion"
  | "acquisition"
  | "documentation"
  | "informational";
export type TrafficMode = "ready" | "listen" | "optimize";

export interface SiteConfig {
  url: string;
  maxPages: number;
  maxDepth: number;
  delayMs: number;
  navigationTimeoutMs: number;
  respectRobots: boolean;
  stripQuery: boolean;
  include: string[];
  exclude: string[];
}

export interface PageRule {
  match: string[];
  role: PageRole;
  goal?: string;
}

export interface ViewportConfig {
  name: string;
  width: number;
  height: number;
}

export interface GuardrailsConfig {
  viewports: ViewportConfig[];
  accessibilityImpacts: string[];
  maxLcpMs: number;
  maxCls: number;
}

export interface BrowserConfig {
  channel?: string;
  headless: boolean;
  settleMs: number;
}

export interface AnalyticsThresholds {
  optimizeMinSessions: number;
  optimizeMinConversions: number;
}

export interface AnalyticsConfig {
  provider: "none" | "file" | "posthog";
  thresholds: AnalyticsThresholds;
  file?: {
    path: string;
  };
  posthog?: {
    host: string;
    projectId: string;
    conversionEvent: string;
    lookbackDays: number;
    keyEnv: string;
  };
}

export interface ArtifactsConfig {
  directory: string;
  screenshots: boolean;
}

export interface ProductBrief {
  audience?: string;
  problem?: string;
  promise?: string;
  primaryAction?: string;
  trafficSource?: string;
}

export type WatchAutonomy = "observe" | "propose" | "autofix_verified_defects";

export interface WatchRule {
  id: string;
  instruction: string;
  autonomy: WatchAutonomy;
}

export interface WatchSchedule {
  naturalLanguage: string;
  cron: string;
  timezone: string;
}

export interface WatchConfig {
  enabled: boolean;
  schedule: WatchSchedule;
  rules: WatchRule[];
}

export interface YlsConfig {
  schemaVersion: 1;
  site: SiteConfig;
  pages: PageRule[];
  product: ProductBrief;
  guardrails: GuardrailsConfig;
  browser: BrowserConfig;
  analytics: AnalyticsConfig;
  artifacts: ArtifactsConfig;
  watch?: WatchConfig;
}

export interface WorkspaceSite {
  id: string;
  configPath: string;
  status: "confirmed";
  proposalId: string;
  configHash: string;
  confirmedAt: string;
}

export interface WorkspaceConfig {
  schemaVersion: 1;
  sites: WorkspaceSite[];
}

export interface OnboardingQuestion {
  id: string;
  prompt: string;
  assumedAnswer: string;
}

export interface OnboardingProposalInput {
  schemaVersion: 1;
  siteId: string;
  configPath: string;
  agent: string;
  assumptions: string[];
  questions: OnboardingQuestion[];
}

export interface OnboardingProposal extends OnboardingProposalInput {
  proposalId: string;
  createdAt: string;
  draftConfig: YlsConfig;
  replacesProposalId?: string;
}

export interface HumanOnboardingAnswers {
  schemaVersion: 1;
  proposalId: string;
  humanConfirmed: true;
  answers: Array<{ questionId: string; answer: string }>;
}

export interface WatchSiteState {
  lastRunId?: string;
  lastRunAt?: string;
  lastScheduledMinute?: string;
  lastAttemptAt?: string;
  lastStatus?: "completed" | "failed";
  lastError?: string;
}

export interface WatchState {
  schemaVersion: 1;
  updatedAt: string;
  sites: Record<string, WatchSiteState>;
}

export interface WatchPageChange {
  path: string;
  before?: string;
  after?: string;
}

export interface WatchDelta {
  baseline: boolean;
  previousRunId?: string;
  addedPaths: string[];
  removedPaths: string[];
  addedFindingRules: string[];
  resolvedFindingRules: string[];
  titleChanges: WatchPageChange[];
  h1Changes: WatchPageChange[];
  statusChanges: Array<{ path: string; before: number | null; after: number | null }>;
}

export interface WatchPacket {
  siteId: string;
  status: "completed";
  runId: string;
  runDirectory: string;
  schedule: WatchSchedule;
  rules: WatchRule[];
  delta: WatchDelta;
  issues: { created: number; updated: number; reopened: number; open: number };
  agentInstruction: string;
  nextCommand: string;
}

export interface AnalyticsSnapshot {
  provider: AnalyticsConfig["provider"];
  available: boolean;
  sessions: number;
  conversions: number;
  conversionRate: number | null;
  lookbackDays?: number;
  note?: string;
}

export interface AccessibilityViolation {
  id: string;
  impact: string | null;
  help: string;
  helpUrl: string;
  nodeCount: number;
  targets: string[];
}

export interface FormEvidence {
  controls: number;
  unlabeledControls: number;
  methods: string[];
  actions: string[];
}

export interface CtaEvidence {
  found: boolean;
  text?: string;
  tag?: string;
  top?: number;
  bottom?: number;
  visible?: boolean;
  withinFirstViewport?: boolean;
}

export interface PerformanceEvidence {
  lcpMs: number | null;
  cls: number;
  domContentLoadedMs: number | null;
  loadMs: number | null;
  transferBytes: number;
  resourceCount: number;
}

export interface PageEvidence {
  url: string;
  path: string;
  role: PageRole;
  goal?: string;
  viewport: ViewportConfig;
  finalUrl?: string;
  status: number | null;
  redirectedOffOrigin: boolean;
  title: string;
  h1: string[];
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
  accessibility: AccessibilityViolation[];
  forms: FormEvidence;
  cta: CtaEvidence;
  horizontalOverflowPx: number;
  performance: PerformanceEvidence;
  screenshot?: string;
}

export interface FindingEvidence {
  path: string;
  viewport: string;
  summary: string;
  details?: Record<string, unknown>;
  screenshot?: string;
}

export interface Finding {
  id: string;
  fingerprint: string;
  rule: string;
  kind: FindingKind;
  severity: Severity;
  confidence: Confidence;
  title: string;
  summary: string;
  affectedPages: string[];
  evidence: FindingEvidence[];
  suggestedAction: string;
  verification: string[];
}

export interface RunArtifact {
  schemaVersion: 1;
  tool: {
    name: "yourlandingsucks";
    version: string;
  };
  runId: string;
  command: "run" | "verify";
  startedAt: string;
  completedAt: string;
  configPath: string;
  config: YlsConfig;
  traffic: {
    mode: TrafficMode;
    snapshot: AnalyticsSnapshot;
    rationale: string;
  };
  discovery: {
    urls: string[];
    skippedByMask: string[];
    skippedByRobots: string[];
    redirectedOffOrigin: string[];
  };
  pages: PageEvidence[];
  findings: Finding[];
  priorityQueue: string[];
}

export interface VerificationArtifact {
  schemaVersion: 1;
  baselineRunId: string;
  verificationRunId: string;
  previewOrigin: string;
  status: "passed" | "failed";
  requiredFindingId?: string;
  requiredFindingResolved?: boolean;
  resolvedFindingIds: string[];
  remainingFindingIds: string[];
  regressionFindingIds: string[];
}

export type FeedbackDecision =
  | "claimed"
  | "released"
  | "blocked"
  | "reopened"
  | "accepted"
  | "rejected"
  | "false_positive"
  | "applied"
  | "verification_passed"
  | "verification_failed"
  | "won"
  | "lost"
  | "inconclusive"
  | "rolled_back";

export interface FeedbackEvent {
  schemaVersion: 1;
  timestamp: string;
  runId: string;
  findingId: string;
  decision: FeedbackDecision;
  reasonCode?: string;
  note?: string;
  agent?: string;
}

export interface FeedbackAggregateRule {
  rule: string;
  findingCount: number;
  eventCount: number;
  decisions: Partial<Record<FeedbackDecision, number>>;
  reasons: Record<string, number>;
  falsePositiveCount: number;
  falsePositiveRate: number | null;
  verificationFailureRate: number | null;
  recurrenceCount: number;
  suggestedMetaAction: "tighten_detection" | "improve_verification" | "add_regression_guard" | "keep_observing";
}

export interface FeedbackAggregate {
  schemaVersion: 1;
  exportsRead: number;
  uniqueRuns: number;
  duplicateRunsSkipped: number;
  rules: FeedbackAggregateRule[];
}

export type IssueStatus = "open" | "claimed" | "blocked" | "rejected" | "verified";

export interface IssueHistoryEvent {
  timestamp: string;
  type: "created" | "synced" | "claimed" | "released" | "blocked" | "rejected" | "verified" | "verification_failed" | "reopened";
  runId: string;
  agent?: string;
  reasonCode?: string;
  verificationRunId?: string;
}

export interface LocalIssue {
  schemaVersion: 1;
  id: string;
  fingerprint: string;
  findingId: string;
  baselineRunId: string;
  firstSeenRunId: string;
  lastSeenRunId: string;
  rule: string;
  title: string;
  kind: FindingKind;
  severity: Severity;
  confidence: Confidence;
  affectedPageCount: number;
  priorityRank: number;
  status: IssueStatus;
  claimedBy?: string;
  claimedAt?: string;
  verifiedAt?: string;
  lastVerificationRunId?: string;
  attempts: number;
  reopenedCount: number;
  history: IssueHistoryEvent[];
}

export interface IssueStore {
  schemaVersion: 1;
  updatedAt: string;
  issues: LocalIssue[];
}

export interface IssueWorkPacket {
  issue: LocalIssue;
  finding: Finding;
  autonomy: {
    mode: "autofix" | "preview_only" | "investigate";
    mayEdit: boolean;
    instruction: string;
    requiresHumanApprovalFor: string[];
  };
  commands: {
    verify: string;
    block: string;
    reject: string;
    release: string;
  };
}

export interface DoctorCheck {
  name: string;
  status: "pass" | "warn" | "fail";
  message: string;
}

export interface DoctorResult {
  status: "passed" | "failed";
  checks: DoctorCheck[];
}
