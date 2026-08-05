#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

function readEnv(path) {
  if (!existsSync(path)) return {};
  return parseEnv(readFileSync(path, "utf8"));
}

function nonEmpty(value) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function resolveDevEnvironment({ baseEnv = process.env, repoRoot }) {
  const exampleEnv = readEnv(resolve(repoRoot, ".env.example"));
  const localEnv = readEnv(resolve(repoRoot, ".env"));
  const sharedDbEnv = readEnv(resolve(repoRoot, "../momo-db/.env.local"));
  const env = { ...localEnv, ...baseEnv };
  const databaseUrl =
    nonEmpty(baseEnv.DATABASE_URL) ??
    nonEmpty(localEnv.DATABASE_URL) ??
    nonEmpty(sharedDbEnv.DIRECT_URL);

  if (!databaseUrl) {
    throw new Error(
      "Local development requires DATABASE_URL. Configure .env or ../momo-db/.env.local before running pnpm dev.",
    );
  }

  env.APP_ENV =
    nonEmpty(baseEnv.APP_ENV) ??
    nonEmpty(localEnv.APP_ENV) ??
    nonEmpty(exampleEnv.APP_ENV) ??
    "dev";
  env.DATABASE_URL = databaseUrl;
  env.MOMO_LOG_FORMAT =
    nonEmpty(baseEnv.MOMO_LOG_FORMAT) ??
    nonEmpty(localEnv.MOMO_LOG_FORMAT) ??
    nonEmpty(exampleEnv.MOMO_LOG_FORMAT) ??
    "text";

  const redisUrl =
    nonEmpty(baseEnv.REDIS_URL) ?? nonEmpty(localEnv.REDIS_URL) ?? nonEmpty(exampleEnv.REDIS_URL);
  if (redisUrl) env.REDIS_URL = redisUrl;

  return env;
}

function startProcess({ args, command, cwd, env, label }) {
  const child = spawn(command, args, {
    cwd,
    detached: process.platform !== "win32",
    env,
    stdio: "inherit",
  });
  const managedProcess = { child, completion: undefined, label, result: undefined };
  managedProcess.completion = new Promise((resolveCompletion) => {
    const finish = (result) => {
      if (managedProcess.result) return;
      managedProcess.result = result;
      resolveCompletion(result);
    };
    child.once("error", (error) => {
      finish({ child, code: null, error, label, signal: null });
    });
    child.once("exit", (code, signal) => {
      finish({ child, code, error: undefined, label, signal });
    });
  });
  return managedProcess;
}

function stopProcess({ child }, signal = "SIGTERM") {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform === "win32") child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch {
    // The process may have exited between the state check and signal delivery.
  }
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

export async function waitForPersistentApi(
  apiProcess,
  env,
  { fetchImpl = fetch, timeoutMs = 240_000 } = {},
) {
  const port = nonEmpty(env.HTTP_PORT) ?? "8080";
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (apiProcess.result?.error) {
      throw new Error(`API could not start: ${apiProcess.result.error.message}`);
    }
    if (apiProcess.result) {
      throw new Error("API exited before becoming ready.");
    }
    try {
      const response = await fetchImpl(`http://127.0.0.1:${port}/healthz/details`, {
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) {
        const health = await response.json();
        if (health.database === "ok") return;
        if (health.database === "disabled") {
          throw new Error(
            "API started without persistent database access. Stop any existing API and rerun pnpm dev.",
          );
        }
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("API started without")) throw error;
    }
    await delay(500);
  }

  throw new Error("API did not become ready with persistent database access in time.");
}

async function run() {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  let env;
  try {
    env = resolveDevEnvironment({ repoRoot });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }

  const apiProcess = startProcess({
    args: ["run"],
    command: "sbt",
    cwd: resolve(repoRoot, "apps/api"),
    env,
    label: "API",
  });
  const processes = [apiProcess];
  let requestedSignal;
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      requestedSignal = signal;
      for (const child of processes) stopProcess(child, signal);
    });
  }

  try {
    await waitForPersistentApi(apiProcess, env);
  } catch (error) {
    if (!requestedSignal) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    stopProcess(apiProcess);
    if (requestedSignal === "SIGINT") process.exitCode = 130;
    else if (requestedSignal === "SIGTERM") process.exitCode = 143;
    return;
  }

  const webProcess = startProcess({
    args: ["--filter", "web", "dev"],
    command: "pnpm",
    cwd: repoRoot,
    env,
    label: "Web",
  });
  processes.push(webProcess);

  const firstExit = await Promise.race(processes.map(({ completion }) => completion));
  for (const child of processes) {
    if (child.child !== firstExit.child) stopProcess(child);
  }

  if (firstExit.error)
    console.error(`${firstExit.label} could not start: ${firstExit.error.message}`);
  if (requestedSignal === "SIGINT") process.exitCode = 130;
  else if (requestedSignal === "SIGTERM") process.exitCode = 143;
  else if (firstExit.error || firstExit.signal) process.exitCode = 1;
  else process.exitCode = firstExit.code ?? 1;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await run();
