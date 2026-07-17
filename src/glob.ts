import type { PageRole, PageRule } from "./types.js";

function normalizePattern(pattern: string): string {
  const trimmed = pattern.trim();
  if (trimmed === "**" || trimmed === "*") return "/**";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

export function globToRegExp(input: string): RegExp {
  const pattern = normalizePattern(input);
  let source = "^";

  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    const next = pattern[index + 1];

    if (char === "/" && next === "*" && pattern[index + 2] === "*") {
      source += "(?:/.*)?";
      index += 2;
      continue;
    }
    if (char === "*" && next === "*") {
      source += ".*";
      index += 1;
      continue;
    }
    if (char === "*") {
      source += "[^/]*";
      continue;
    }
    if (char === "?") {
      source += "[^/]";
      continue;
    }
    if (char && "\\^$+.|()[]{}".includes(char)) {
      source += `\\${char}`;
      continue;
    }
    source += char;
  }

  source += "$";
  return new RegExp(source);
}

export function matchesGlob(path: string, pattern: string): boolean {
  return globToRegExp(pattern).test(path);
}

export function isPathIncluded(
  path: string,
  include: string[],
  exclude: string[],
): boolean {
  if (exclude.some((pattern) => matchesGlob(path, pattern))) return false;
  if (include.length === 0) return true;
  return include.some((pattern) => matchesGlob(path, pattern));
}

export function classifyPath(
  path: string,
  rules: PageRule[],
): { role: PageRole; goal?: string } {
  for (const rule of rules) {
    if (rule.match.some((pattern) => matchesGlob(path, pattern))) {
      return { role: rule.role, ...(rule.goal ? { goal: rule.goal } : {}) };
    }
  }
  return { role: "informational" };
}
