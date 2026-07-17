import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, normalize, relative, resolve } from "node:path";

const currentPackageVersion = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;

export function stableHash(value: string, length = 12): string {
  return createHash("sha256").update(value).digest("hex").slice(0, length);
}

export function createRunId(date = new Date()): string {
  const stamp = date.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  return `${stamp}-${stableHash(`${date.toISOString()}-${Math.random()}`, 8)}`;
}

export function slugForPath(path: string): string {
  if (path === "/") return "home";
  const value = path
    .replace(/^\/+|\/+$/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
  return value || "page";
}

export async function ensureDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await ensureDirectory(dirname(path));
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await ensureDirectory(dirname(path));
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

export async function delay(milliseconds: number): Promise<void> {
  if (milliseconds <= 0) return;
  await new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

export function assertSafeRelativeDirectory(path: string): void {
  if (!path || isAbsolute(path)) {
    throw new Error("artifacts.directory must be a non-empty relative path");
  }
  const normalized = normalize(path);
  if (normalized === ".." || normalized.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) {
    throw new Error("artifacts.directory must stay inside the project directory");
  }
}

export function pathInside(base: string, candidate: string): boolean {
  const rel = relative(resolve(base), resolve(candidate));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function packageVersion(): string {
  return currentPackageVersion;
}
