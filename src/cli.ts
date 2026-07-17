#!/usr/bin/env node
import { dirname, resolve } from "node:path";
import { checkAgentIntegration, installAgentIntegration } from "./agent-integration.js";
import { executeAuditRun } from "./artifacts.js";
import { initializeProject, loadConfig } from "./config.js";
import { runDoctor } from "./doctor.js";
import { aggregateFeedback, exportFeedback, recordFeedback } from "./feedback.js";
import { getIssue, loadIssueStore, nextIssue, syncIssues, updateIssue, verifyIssue } from "./issues.js";
import { verifyPreview } from "./verify.js";
import { runWatch } from "./watch.js";
import { confirmSite, draftSite, listWorkspaceSites, loadWorkspaceSite, proposeSite } from "./workspace.js";

interface ParsedArgs {
  positionals: string[];
  flags: Record<string, string | true>;
}

function parseArgs(args: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index]!;
    if (!value.startsWith("--")) {
      positionals.push(value);
      continue;
    }
    const name = value.slice(2);
    const next = args[index + 1];
    if (!next || next.startsWith("--")) {
      flags[name] = true;
    } else {
      flags[name] = next;
      index += 1;
    }
  }
  return { positionals, flags };
}

function stringFlag(parsed: ParsedArgs, name: string, required = false): string | undefined {
  const value = parsed.flags[name];
  if (value === true || value === undefined) {
    if (required) throw new Error(`--${name} is required`);
    return undefined;
  }
  return value;
}

function print(value: unknown, json: boolean): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(value)}\n`);
  } else if (typeof value === "string") {
    process.stdout.write(`${value}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  }
}

function help(): string {
  return `YourLandingSucks — evidence and verification for agent-driven public-page work

Usage:
  yls agent install [--json]
  yls agent check [--json]
  yls init --url <origin> [--config yls.yaml] [--force]
  yls site draft --id <id> --url <origin> [--config <site.yaml>] [--proposal <draft.yaml>] [--agent <name>] [--force] [--json]
  yls site propose --file <proposal.yaml> [--replace] [--workspace yls.workspace.yaml] [--json]
  yls site confirm --proposal <stored-proposal.json> --answers <human-answers.yaml> [--config <final-site.yaml>] [--workspace <file>] [--json]
  yls site list [--workspace yls.workspace.yaml] [--json]
  yls doctor [--site <id> --workspace <file> | --config yls.yaml] [--json]
  yls run [--site <id> --workspace <file> | --config yls.yaml] [--json]
  yls watch tick [--site <id>] [--at <iso-time>] [--workspace <file>] [--json]
  yls watch run --site <id> [--at <iso-time>] [--workspace <file>] [--json]
  yls verify --against <run-id> --preview <origin> [--finding <id>] [--site <id>] [--json]
  yls issue sync --run <run-id> [--all] [--site <id>] [--json]
  yls issue list [--status <open|claimed|blocked|rejected|verified>] [--site <id>] [--json]
  yls issue next [--agent <name>] [--peek] [--site <id>] [--json]
  yls issue show --id <issue-id> [--site <id>] [--json]
  yls issue update --id <issue-id> --status <open|blocked|rejected> [--reason-code <code>] [--note <local-only>] [--agent <name>] [--site <id>] [--json]
  yls issue verify --id <issue-id> --preview <origin> [--agent <name>] [--site <id>] [--json]
  yls feedback --run <run-id> --finding <id> --decision <value> [--reason-code <code>] [--note <local-only>] [--agent <name>] [--site <id>] [--json]
  yls feedback export --run <run-id> --output <file> [--site <id>] [--json]
  yls feedback aggregate --input <export-file-or-directory> [--output <file>] [--json]

YLS never calls an LLM. Any shell-capable coding agent can use these commands and read evidence.json/brief.md.`;
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  const command = parsed.positionals[0];
  const json = parsed.flags.json === true;
  const configFlag = stringFlag(parsed, "config") ?? "yls.yaml";
  const workspaceFlag = stringFlag(parsed, "workspace") ?? "yls.workspace.yaml";

  if (!command || command === "help" || parsed.flags.help === true) {
    print(help(), false);
    return;
  }

  if (command === "init") {
    const result = await initializeProject({
      url: stringFlag(parsed, "url", true)!,
      configPath: configFlag,
      force: parsed.flags.force === true,
    });
    print({ status: "initialized", ...result }, json);
    return;
  }

  if (command === "agent") {
    const subcommand = parsed.positionals[1];
    if (subcommand === "install") {
      print(await installAgentIntegration(), json);
      return;
    }
    if (subcommand === "check") {
      const result = await checkAgentIntegration();
      print(result, json);
      if (!result.current) process.exitCode = 1;
      return;
    }
    throw new Error(`Unknown agent command: ${subcommand ?? "(missing)"}`);
  }

  if (command === "feedback" && parsed.positionals[1] === "aggregate") {
    const aggregate = await aggregateFeedback({
      input: stringFlag(parsed, "input", true)!,
      ...(stringFlag(parsed, "output") ? { output: stringFlag(parsed, "output") } : {}),
    });
    print(aggregate, json);
    return;
  }

  if (command === "site") {
    const subcommand = parsed.positionals[1];
    if (subcommand === "draft") {
      const result = await draftSite({
        siteId: stringFlag(parsed, "id", true)!,
        url: stringFlag(parsed, "url", true)!,
        ...(stringFlag(parsed, "config") ? { configPath: stringFlag(parsed, "config") } : {}),
        ...(stringFlag(parsed, "proposal") ? { proposalPath: stringFlag(parsed, "proposal") } : {}),
        ...(stringFlag(parsed, "agent") ? { agent: stringFlag(parsed, "agent") } : {}),
        force: parsed.flags.force === true,
      });
      print({ status: "drafted", ...result, nextCommand: `yls site propose --file ${JSON.stringify(result.proposalPath)} --json` }, json);
      return;
    }
    if (subcommand === "propose") {
      const result = await proposeSite({
        proposalFile: stringFlag(parsed, "file", true)!,
        replace: parsed.flags.replace === true,
        workspacePath: workspaceFlag,
      });
      print({
        status: "awaiting_human_confirmation",
        proposalId: result.proposal.proposalId,
        proposalPath: result.proposalPath,
        assumptions: result.proposal.assumptions,
        questions: result.proposal.questions,
        nextCommand: `yls site confirm --proposal ${JSON.stringify(result.proposalPath)} --answers <human-answers.yaml> --workspace ${JSON.stringify(workspaceFlag)} --json`,
      }, json);
      return;
    }
    if (subcommand === "confirm") {
      const result = await confirmSite({
        proposalPath: stringFlag(parsed, "proposal", true)!,
        answersFile: stringFlag(parsed, "answers", true)!,
        ...(stringFlag(parsed, "config") ? { configPath: stringFlag(parsed, "config") } : {}),
        workspacePath: workspaceFlag,
      });
      print({ status: "confirmed", ...result }, json);
      return;
    }
    if (subcommand === "list") {
      const result = await listWorkspaceSites({ workspacePath: workspaceFlag });
      print({ status: "listed", ...result, count: result.sites.length }, json);
      return;
    }
    throw new Error(`Unknown site command: ${subcommand ?? "(missing)"}`);
  }

  if (command === "watch") {
    const subcommand = parsed.positionals[1];
    if (subcommand !== "tick" && subcommand !== "run") throw new Error(`Unknown watch command: ${subcommand ?? "(missing)"}`);
    const result = await runWatch({
      mode: subcommand,
      ...(stringFlag(parsed, "site") ? { siteId: stringFlag(parsed, "site") } : {}),
      ...(stringFlag(parsed, "at") ? { at: stringFlag(parsed, "at") } : {}),
      workspacePath: workspaceFlag,
    });
    print(result, json);
    if (result.status === "partial_failure") process.exitCode = 1;
    return;
  }

  const selectedSiteId = stringFlag(parsed, "site");
  const selected = selectedSiteId
    ? await loadWorkspaceSite({ siteId: selectedSiteId, workspacePath: workspaceFlag })
    : undefined;
  const loaded = selected
    ? { path: selected.configPath, config: selected.config }
    : await loadConfig(configFlag);
  if (command === "doctor") {
    const result = await runDoctor(loaded.config, dirname(loaded.path));
    print(selectedSiteId ? { siteId: selectedSiteId, ...result } : result, json);
    if (result.status === "failed") process.exitCode = 1;
    return;
  }

  if (command === "run") {
    const result = await executeAuditRun({ config: loaded.config, configPath: loaded.path });
    print(
      {
        status: "completed",
        ...(selectedSiteId ? { siteId: selectedSiteId } : {}),
        runId: result.run.runId,
        runDirectory: result.runDirectory,
        evidence: resolve(result.runDirectory, "evidence.json"),
        brief: resolve(result.runDirectory, "brief.md"),
        trafficMode: result.run.traffic.mode,
        routes: result.run.discovery.urls.length,
        findings: result.run.findings.length,
        priorityQueue: result.run.priorityQueue,
      },
      json,
    );
    return;
  }

  if (command === "verify") {
    const result = await verifyPreview({
      config: loaded.config,
      configPath: loaded.path,
      baselineRunId: stringFlag(parsed, "against", true)!,
      previewUrl: stringFlag(parsed, "preview", true)!,
      ...(stringFlag(parsed, "finding") ? { requiredFindingId: stringFlag(parsed, "finding") } : {}),
    });
    print(
      {
        ...result.verification,
        runDirectory: result.runDirectory,
        verification: resolve(result.runDirectory, "verification.json"),
      },
      json,
    );
    if (result.verification.status === "failed") process.exitCode = 2;
    return;
  }

  if (command === "issue") {
    const subcommand = parsed.positionals[1];
    if (subcommand === "sync") {
      const result = await syncIssues({
        config: loaded.config,
        runId: stringFlag(parsed, "run", true)!,
        scope: parsed.flags.all === true ? "all" : "priority",
      });
      print({
        status: "synced",
        created: result.created,
        updated: result.updated,
        reopened: result.reopened,
        issues: result.issues.map(({ id, status, title, priorityRank, claimedBy }) => ({
          id,
          status,
          title,
          priorityRank,
          ...(claimedBy ? { claimedBy } : {}),
        })),
      }, json);
      return;
    }
    if (subcommand === "list") {
      const store = await loadIssueStore(loaded.config);
      const status = stringFlag(parsed, "status");
      const issues = status ? store.issues.filter((issue) => issue.status === status) : store.issues;
      print({ status: "listed", count: issues.length, issues }, json);
      return;
    }
    if (subcommand === "next") {
      const packet = await nextIssue({
        config: loaded.config,
        agent: stringFlag(parsed, "agent") ?? "coding-agent",
        peek: parsed.flags.peek === true,
      });
      print(packet ? { status: parsed.flags.peek === true ? "available" : "claimed", ...packet } : { status: "empty" }, json);
      return;
    }
    if (subcommand === "show") {
      const packet = await getIssue({ config: loaded.config, issueId: stringFlag(parsed, "id", true)! });
      print({ status: "found", ...packet }, json);
      return;
    }
    if (subcommand === "update") {
      const packet = await updateIssue({
        config: loaded.config,
        issueId: stringFlag(parsed, "id", true)!,
        status: stringFlag(parsed, "status", true)!,
        ...(stringFlag(parsed, "reason-code") ? { reasonCode: stringFlag(parsed, "reason-code") } : {}),
        ...(stringFlag(parsed, "note") ? { note: stringFlag(parsed, "note") } : {}),
        ...(stringFlag(parsed, "agent") ? { agent: stringFlag(parsed, "agent") } : {}),
      });
      print({ status: "updated", ...packet }, json);
      return;
    }
    if (subcommand === "verify") {
      const verification = await verifyIssue({
        config: loaded.config,
        configPath: loaded.path,
        issueId: stringFlag(parsed, "id", true)!,
        previewUrl: stringFlag(parsed, "preview", true)!,
        ...(stringFlag(parsed, "agent") ? { agent: stringFlag(parsed, "agent") } : {}),
      });
      print({
        status: verification.result.verification.status,
        issue: verification.issue,
        verification: verification.result.verification,
        runDirectory: verification.result.runDirectory,
      }, json);
      if (verification.result.verification.status === "failed") process.exitCode = 2;
      return;
    }
    throw new Error(`Unknown issue command: ${subcommand ?? "(missing)"}`);
  }

  if (command === "feedback") {
    const subcommand = parsed.positionals[1];
    if (subcommand === "export") {
      const payload = await exportFeedback({
        config: loaded.config,
        runId: stringFlag(parsed, "run", true)!,
        output: stringFlag(parsed, "output", true)!,
      });
      print(payload, true);
      return;
    }
    const event = await recordFeedback({
      config: loaded.config,
      runId: stringFlag(parsed, "run", true)!,
      findingId: stringFlag(parsed, "finding", true)!,
      decision: stringFlag(parsed, "decision", true)!,
      ...(stringFlag(parsed, "reason-code") ? { reasonCode: stringFlag(parsed, "reason-code") } : {}),
      ...(stringFlag(parsed, "note") ? { note: stringFlag(parsed, "note") } : {}),
      ...(stringFlag(parsed, "agent") ? { agent: stringFlag(parsed, "agent") } : {}),
    });
    print({ status: "recorded", event }, json);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  const json = process.argv.includes("--json");
  const payload = { status: "error", message: error instanceof Error ? error.message : String(error) };
  if (json) process.stderr.write(`${JSON.stringify(payload)}\n`);
  else process.stderr.write(`Error: ${payload.message}\n`);
  process.exitCode = 1;
});
