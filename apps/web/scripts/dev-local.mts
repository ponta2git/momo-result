#!/usr/bin/env node
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

import { createInterruptionSignal, stopProcessGroup } from "./process.mts";

function readEnv(path: string): NodeJS.ProcessEnv {
  try {
    return parseEnv(readFileSync(path, "utf8"));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return {};
    throw new Error(`Could not read environment file: ${path}`, { cause: error });
  }
}

function nonEmpty(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

export function resolveDevEnvironment({
  baseEnv = process.env,
  repoRoot,
}: {
  baseEnv?: NodeJS.ProcessEnv;
  repoRoot: string;
}): NodeJS.ProcessEnv {
  const example = readEnv(resolve(repoRoot, ".env.example"));
  const local = readEnv(resolve(repoRoot, ".env"));
  // Only consult the sibling when no explicit database has been selected.
  const database =
    nonEmpty(baseEnv["DATABASE_URL"]) ??
    nonEmpty(local["DATABASE_URL"]) ??
    nonEmpty(readEnv(resolve(repoRoot, "../momo-db/.env.local"))["DIRECT_URL"]);
  if (!database) {
    throw new Error(
      "Local development requires DATABASE_URL. Configure .env or ../momo-db/.env.local before running pnpm dev.",
    );
  }
  const env: NodeJS.ProcessEnv = { ...local, ...baseEnv, DATABASE_URL: database };
  for (const [key, fallback] of [
    ["APP_ENV", "dev"],
    ["MOMO_LOG_FORMAT", "text"],
  ] as const) {
    const value =
      nonEmpty(baseEnv[key]) ?? nonEmpty(local[key]) ?? nonEmpty(example[key]) ?? fallback;
    if (value !== undefined) env[key] = value;
  }
  return env;
}

type Exit = { code: number | null; signal: NodeJS.Signals | null; error?: Error };
type ManagedProcess = { child: ChildProcess; completion: Promise<Exit>; result?: Exit };

function startProcess(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): ManagedProcess {
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: "inherit",
    detached: process.platform !== "win32",
  });
  let finish: (result: Exit) => void;
  const completion = new Promise<Exit>((resolveExit) => {
    finish = resolveExit;
  });
  const managed: ManagedProcess = { child, completion };
  const exited = (result: Exit) => {
    if (managed.result) return;
    managed.result = result;
    finish(result);
  };
  child.once("error", (error) => exited({ code: null, signal: null, error }));
  child.once("exit", (code, signal) => exited({ code, signal }));
  return managed;
}

export async function waitForPersistentApi(
  api: { result?: Exit },
  port: number,
  signal: AbortSignal,
  { fetchImpl = fetch, timeoutMs = 240_000 } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    if (api.result) {
      throw new Error(
        "API exited before becoming ready. Run `pnpm --dir ../momo-db db:migrate` and inspect the API log above.",
      );
    }
    let response: Response | undefined;
    let health: unknown;
    try {
      response = await fetchImpl(`http://127.0.0.1:${port}/healthz/details`, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(2_000)]),
      });
      health = await response.json();
    } catch {
      // Startup may not have bound the socket yet. Cancellation still exits immediately.
      signal.throwIfAborted();
    }
    if (health !== null && typeof health === "object" && "database" in health) {
      if (response?.ok && health.database === "ok") return;
      if (health.database === "disabled") {
        throw new Error(
          "API started without persistent database access. Stop any existing API and rerun pnpm dev.",
        );
      }
      if (health.database === "unavailable") {
        throw new Error(
          "API cannot reach the configured database. Run `pnpm --dir ../momo-db db:up` and `pnpm --dir ../momo-db db:migrate`, or verify DATABASE_URL.",
        );
      }
    }
    await delay(500, undefined, { signal });
  }
  throw new Error("API did not become ready with persistent database access in time.");
}

async function requireFreePort(port: number): Promise<void> {
  const server = createServer();
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", () =>
      rejectListen(new Error("API port is unavailable; stop the existing API or set HTTP_PORT.")),
    );
    server.listen(port, "127.0.0.1", () =>
      server.close((error) => (error ? rejectListen(error) : resolveListen())),
    );
  });
}

async function run(): Promise<void> {
  const args = process.argv.slice(2);
  const usage = "Usage: dev-local\nStarts the local API and web development servers.";
  if (args.length === 1 && (args[0] === "-h" || args[0] === "--help")) {
    console.log(usage);
    return;
  }
  if (args.length !== 0) {
    console.error(`dev-local accepts no arguments.\n${usage}`);
    process.exitCode = 2;
    return;
  }
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  const env = resolveDevEnvironment({ repoRoot });
  const rawPort = nonEmpty(env["HTTP_PORT"]) ?? "8080";
  const port = Number(rawPort);
  if (!/^\d+$/u.test(rawPort) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("HTTP_PORT must be an integer from 1 to 65535.");
  }
  await requireFreePort(port);
  const signal = createInterruptionSignal();
  const processes: ManagedProcess[] = [];
  const failures: unknown[] = [];
  try {
    const api = startProcess("sbt", ["--server", "run"], resolve(repoRoot, "apps/api"), env);
    processes.push(api);
    await waitForPersistentApi(api, port, signal);
    signal.throwIfAborted();
    processes.push(
      startProcess("pnpm", ["--filter", "web", "dev"], repoRoot, {
        ...env,
        VITE_API_PROXY_TARGET: `http://127.0.0.1:${port}`,
      }),
    );
    const first = await Promise.race([
      ...processes.map(({ completion }) => completion),
      new Promise<undefined>((resolveAbort) =>
        signal.addEventListener("abort", () => resolveAbort(undefined), { once: true }),
      ),
    ]);
    if (first && !signal.aborted) {
      if (first.error) console.error(first.error.message);
      process.exitCode = first.error || first.signal ? 1 : (first.code ?? 1);
    }
  } catch (error) {
    if (!signal.aborted) failures.push(error);
  } finally {
    const cleanup = await Promise.allSettled(processes.map(({ child }) => stopProcessGroup(child)));
    failures.push(
      ...cleanup.filter((result) => result.status === "rejected").map((result) => result.reason),
    );
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(failures, "Development processes failed to run or stop.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await run();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
