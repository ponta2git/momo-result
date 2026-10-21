import { spawn } from "node:child_process";
import { openSync, closeSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

export const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
export const algorithmVersion = "series-analysis-v7";
export const releaseId = "0123456789abcdef0123456789abcdef01234567";
type Options = {
  input?: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  timeoutMs?: number;
  log?: string;
};
export type Result = { code: number | null; signal: NodeJS.Signals | null; stdout: string };

// Never include argv, child stderr or raw stdout in exceptions: commands carry
// database credentials and provider diagnostics may repeat them.
export function startCommand(file: string, args: string[], options: Options = {}) {
  if (options.signal?.aborted) throw new Error("Command cancelled.");
  const fd = options.log ? openSync(options.log, "a", 0o600) : undefined;
  const child = spawn(file, args, {
    cwd: repoRoot,
    detached: process.platform !== "win32",
    env: options.env ?? process.env,
    stdio: ["pipe", fd ?? "pipe", fd ?? "pipe"],
  });
  if (fd !== undefined) closeSync(fd);
  let stdout = "";
  let failure: Error | undefined;
  let closed = false;
  let escalation: ReturnType<typeof setTimeout> | undefined;
  const killGroup = (signal: NodeJS.Signals) => {
    if (process.platform === "win32") child.kill(signal);
    else if (child.pid !== undefined) {
      try {
        process.kill(-child.pid, signal);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
    }
  };
  const stop = (reason: string) => {
    if (closed) return;
    failure ??= new Error(reason);
    // The leader may have exited while its descendants still hold stdio open.
    // Own the POSIX group so close cannot hang behind those descendants.
    killGroup("SIGTERM");
    escalation ??= setTimeout(() => killGroup("SIGKILL"), 1_000);
  };
  const abort = () => stop("Command cancelled.");
  const timer = options.timeoutMs
    ? setTimeout(() => stop("Command timed out."), options.timeoutMs)
    : undefined;
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    stdout += chunk;
    if (stdout.length > 8 * 1024 * 1024) stop("Command output exceeded its limit.");
  });
  child.stderr?.resume();
  child.stdin?.on("error", () => {
    /* The exit status owns early stdin closure. */
  });
  child.stdin?.end(options.input);
  const done = new Promise<Result>((resolve, reject) => {
    child.once("error", () => {
      failure ??= new Error("Command could not be started.");
    });
    child.once("close", (code, signal) => {
      closed = true;
      clearTimeout(timer);
      clearTimeout(escalation);
      options.signal?.removeEventListener("abort", abort);
      if (failure) reject(failure);
      else resolve({ code, signal, stdout: stdout.trimEnd() });
    });
  });
  // Background resources are joined in finally; an early exit is not an
  // unhandled rejection while their owner is inspecting another resource.
  void done.catch(() => {});
  return { done, stop: () => stop("Command stopped.") };
}

export async function command(
  file: string,
  args: string[],
  options: Options = {},
): Promise<Result> {
  return startCommand(file, args, { timeoutMs: 60_000, ...options }).done;
}
let containerSequence = 0;
async function containerCommand(args: string[], options: Options) {
  const name = `momo-smoke-command-${process.pid}-${++containerSequence}`;
  try {
    return await command("docker", ["run", "--name", name, ...args.slice(1)], options);
  } catch (error) {
    // Killing the attached CLI alone does not prove that its container exited.
    await command("docker", ["rm", "--force", name], { timeoutMs: 10_000 }).catch(() => {});
    throw error;
  }
}
export function requireSuccess(result: Result, description: string): string {
  if (result.code !== 0 || result.signal !== null) throw new Error(`${description} failed.`);
  return result.stdout;
}
export function check(condition: unknown, description: string): asserts condition {
  if (!condition) throw new Error(description);
}

export async function waitFor(
  description: string,
  probe: (signal: AbortSignal) => Promise<boolean>,
  options: { timeoutMs?: number; intervalMs?: number; signal?: AbortSignal } = {},
) {
  const deadline = AbortSignal.timeout(options.timeoutMs ?? 180_000);
  const signal = options.signal ? AbortSignal.any([deadline, options.signal]) : deadline;
  try {
    while (true) {
      signal.throwIfAborted();
      if (await probe(signal)) return;
      await delay(options.intervalMs ?? 1_000, undefined, { signal });
    }
  } catch (error) {
    if (deadline.aborted) throw new Error(`Timed out waiting for ${description}.`);
    if (options.signal?.aborted) throw new Error("Smoke cancelled.");
    throw error;
  }
}

// Every cleanup runs, even when an earlier resource fails to release. A cleanup
// failure must not turn a failed smoke into success or hide its original cause.
export async function cleanups(tasks: Array<() => Promise<unknown> | unknown>) {
  let firstFailure: unknown;
  for (const task of tasks) {
    try {
      await task();
    } catch (error) {
      firstFailure ??= error;
    }
  }
  if (firstFailure !== undefined) {
    const detail =
      firstFailure instanceof Error ? firstFailure.message : "Unknown resource failure.";
    throw new Error(`Smoke resource cleanup failed: ${detail}`);
  }
}

export function records(text: string): Record<string, unknown>[] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        throw new Error("Invalid JSON report.");
      }
      check(
        value !== null && typeof value === "object" && !Array.isArray(value),
        "Expected a JSON report object.",
      );
      return value as Record<string, unknown>;
    });
}
export function report(text: string): Record<string, unknown> {
  const reports = records(text).filter(
    (value) => "schemaVersion" in value && "planDigest" in value,
  );
  check(reports.length === 1, "Expected exactly one maintenance report.");
  return reports[0]!;
}
export function eventFields(text: string): Record<string, unknown>[] {
  return text.split(/\r?\n/).flatMap((line) => {
    try {
      const entry = JSON.parse(line) as { fields?: unknown; span?: unknown };
      const fields = entry.fields;
      if (!fields || typeof fields !== "object" || Array.isArray(fields)) return [];
      // tracing_subscriber writes correlation fields in the current span and
      // event-specific metrics in fields. Both belong to this one log record.
      const span = entry.span;
      return [
        {
          ...(span && typeof span === "object" && !Array.isArray(span) ? span : {}),
          ...fields,
        },
      ];
    } catch {
      return [];
    }
  });
}
export function safeDiagnostics(text: string) {
  return eventFields(text.split(/\r?\n/).slice(-100).join("\n"))
    .map((fields) =>
      Object.fromEntries(
        Object.entries(fields).filter(
          ([key, value]) =>
            ["event", "outcome", "reason", "error_kind", "safe_failure_code"].includes(key) &&
            typeof value === "string" &&
            /^[a-z][a-z0-9_]{0,95}$/.test(value),
        ),
      ),
    )
    .filter((fields) => Object.keys(fields).length > 0);
}

export class Smoke {
  readonly signal: AbortSignal;
  readonly root: string;
  readonly log: string;
  readonly database = process.env.DATABASE_URL ?? "";
  readonly postgresImage = process.env.POSTGRES_IMAGE ?? "postgres:18-alpine";
  readonly contract: { artifactSchemaVersion: number; validationContractId: string };
  constructor(signal: AbortSignal) {
    this.signal = signal;
    this.contract = JSON.parse(
      readFileSync(
        join(repoRoot, "docs/schemas/series-analysis-publication-contract-v2.json"),
        "utf8",
      ),
    );
    check(
      typeof this.contract.artifactSchemaVersion === "number" &&
        Number.isInteger(this.contract.artifactSchemaVersion) &&
        this.contract.artifactSchemaVersion >= 1 &&
        typeof this.contract.validationContractId === "string" &&
        /^[a-z0-9][a-z0-9._-]{0,127}$/.test(this.contract.validationContractId),
      "Invalid publication contract.",
    );
    check(this.database, "DATABASE_URL is required.");
    this.root = mkdtempSync(join(tmpdir(), "momo-worker-smoke-"));
    this.log = join(this.root, "worker.log");
  }
  capability(worker: string) {
    return `${worker}@${algorithmVersion}@${this.contract.artifactSchemaVersion}@${this.contract.validationContractId}`;
  }
  async isolated(postgres: Record<string, string>) {
    requireSuccess(
      await command(
        "bash",
        [
          "-euc",
          `
        source scripts/ci/analysis-smoke-safety.sh
        analysis_smoke_require_isolated_services
        analysis_smoke_require_bootstrapped_postgres "$1" "$DATABASE_URL"
        postgres_image="$1"; shift
        analysis_smoke_require_same_postgres_database "$postgres_image" "$DATABASE_URL" "$@"
      `,
          "worker-smoke-isolation",
          this.postgresImage,
          ...Object.entries(postgres).flat(),
        ],
        { signal: this.signal },
      ),
      "Isolated database verification",
    );
  }
  sqlArgs(variables: Record<string, string | number> = {}) {
    return [
      "run",
      "--rm",
      "-i",
      "--network",
      "host",
      "--add-host",
      "host.docker.internal:host-gateway",
      "-e",
      `DATABASE_URL=${this.database}`,
      this.postgresImage,
      "psql",
      "-X",
      this.database,
      "-v",
      "ON_ERROR_STOP=1",
      "-At",
      ...Object.entries(variables).flatMap(([key, value]) => ["-v", `${key}=${value}`]),
    ];
  }
  async sql(
    input: string,
    variables: Record<string, string | number> = {},
    signal: AbortSignal | null = this.signal,
  ) {
    return requireSuccess(
      await containerCommand(this.sqlArgs(variables), {
        input: `\\set QUIET 1
${readFileSync(new URL("../../apps/processing-worker/testdata/canonical-fixture.sql", import.meta.url), "utf8")}
\\set QUIET 0
${input}`,
        signal: signal ?? undefined,
      }),
      "PostgreSQL command",
    );
  }
  async sqlFile(name: string, variables: Record<string, string | number> = {}, cleanup = false) {
    const input = readFileSync(new URL(`sql/${name}.sql`, import.meta.url), "utf8");
    return this.sql(input, variables, cleanup ? null : this.signal);
  }
  async release(image: string, database: string, args: string[], binary = "") {
    return image
      ? containerCommand(
          [
            "run",
            "--rm",
            "--network",
            "host",
            "--add-host",
            "host.docker.internal:host-gateway",
            "-e",
            `DATABASE_URL=${database}`,
            image,
            "/usr/local/bin/momo-processing-worker",
            "bootstrap",
            "--",
            ...args,
          ],
          { signal: this.signal, timeoutMs: 120_000 },
        )
      : command(binary, args, {
          env: { ...process.env, DATABASE_URL: database },
          signal: this.signal,
          timeoutMs: 120_000,
        });
  }
  async running(container: string, signal = this.signal) {
    const result = await command(
      "docker",
      ["inspect", "--format", "{{.State.Running}}", container],
      { signal },
    );
    check(
      result.code === 0 && result.stdout === "true",
      "Worker exited before its expected state.",
    );
  }
  async waitSQL(
    expected: string,
    query: string,
    description: string,
    options: {
      container?: string;
      rejectFailedJobs?: boolean;
      timeoutMs?: number;
      intervalMs?: number;
    } = {},
  ) {
    await waitFor(
      description,
      async (signal) => {
        if ((await this.sql(query, {}, signal)) === expected) return true;
        if (options.rejectFailedJobs)
          check(
            (await this.sql(
              "SELECT COUNT(*)::int FROM series_analysis_jobs WHERE status IN ('failed','timed_out');",
              {},
              signal,
            )) === "0",
            "A worker job failed.",
          );
        if (options.container) await this.running(options.container, signal);
        return false;
      },
      { ...options, signal: this.signal },
    );
  }
  logs() {
    try {
      return readFileSync(this.log, "utf8");
    } catch {
      return "";
    }
  }
  remove() {
    rmSync(this.root, { recursive: true, force: true });
  }
}

export async function runSmoke(name: string, action: (signal: AbortSignal) => Promise<void>) {
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  try {
    await action(controller.signal);
    check(!controller.signal.aborted, "Smoke cancelled.");
    console.log(`${name} passed.`);
  } catch (error) {
    // Suites throw curated messages; raw child exceptions are never propagated.
    console.error(error instanceof Error ? error.message : `${name} failed.`);
    process.exitCode = 1;
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
  }
}

export function analysisEnvironment(database: string, worker: string): Record<string, string> {
  return {
    DATABASE_URL: database,
    MOMO_PROCESSING_LISTENER_DATABASE_URL: database,
    MOMO_ANALYSIS_READ_DATABASE_URL: database,
    MOMO_PROCESSING_RECOVERY_INTERVAL_MS: "1000",
    MOMO_ANALYSIS_PUBLICATION_MODE: "enabled",
    MOMO_ANALYSIS_RUNTIME_MEMORY_LIMIT_BYTES: "268435456",
    MOMO_ANALYSIS_CHILD_MEMORY_LIMIT_BYTES: "201326592",
    MOMO_ANALYSIS_PARENT_HEADROOM_BYTES: "67108864",
    MOMO_ANALYSIS_CALCULATION_TIMEOUT_MS: "120000",
    MOMO_ANALYSIS_FINALIZATION_TIMEOUT_MS: "30000",
    MOMO_ANALYSIS_TEMPORARY_MAX_BYTES: "67108864",
    MOMO_ANALYSIS_CHUNK_MAX_BYTES: "8388608",
    MOMO_ANALYSIS_CHUNK_COUNT_MAX: "4096",
    MOMO_ANALYSIS_TEMPORARY_FILE_COUNT_MAX: "4097",
    MOMO_ANALYSIS_WORKER_ID: worker,
    MOMO_ANALYSIS_TEMPORARY_ROOT: "/var/lib/momo-analysis",
    MOMO_ANALYSIS_LEASE_DURATION_MS: "70000",
    MOMO_ANALYSIS_HEARTBEAT_INTERVAL_MS: "1000",
    MOMO_ANALYSIS_HEARTBEAT_TIMEOUT_MS: "5000",
    MOMO_ANALYSIS_CHILD_STOP_GRACE_MS: "1000",
    MOMO_HEAVY_CGROUP_V2_VALIDATED: "true",
    MOMO_OCR_V2_CONSUMER_MODE: "disabled",
    MOMO_LOG_FORMAT: "json",
    RUST_LOG: "momo_processing_worker=info,momo_notifications=info",
  };
}
export function startWorker(
  smoke: Pick<Smoke, "signal" | "log">,
  container: string,
  image: string,
  env: Record<string, string>,
) {
  const child = startCommand(
    "docker",
    [
      "run",
      "--rm",
      "--name",
      container,
      "--privileged",
      "--cgroupns",
      "private",
      "--memory",
      "256m",
      "--memory-swap",
      "256m",
      "--add-host",
      "host.docker.internal:host-gateway",
      "--tmpfs",
      "/var/lib/momo-analysis:rw,noexec,nosuid,size=67108864,uid=10001,gid=10001,mode=0700",
      ...Object.entries(env).flatMap(([key, value]) => ["--env", `${key}=${value}`]),
      image,
    ],
    { log: smoke.log },
  );
  let exited = false;
  void child.done.then(
    () => {
      exited = true;
    },
    () => {
      exited = true;
    },
  );
  let stopped = false;
  return {
    async ready() {
      await waitFor(
        "worker container startup",
        async (signal) => {
          check(!exited, "Worker exited before container startup.");
          const state = await command(
            "docker",
            ["inspect", "--format", "{{.State.Running}}", container],
            { signal },
          );
          // docker run is asynchronous: absence here is not evidence of exit.
          return state.code === 0 && state.stdout === "true";
        },
        { timeoutMs: 30_000, intervalMs: 100, signal: smoke.signal },
      );
    },
    async stop() {
      if (stopped) return;
      stopped = true;
      try {
        requireSuccess(
          await command("docker", ["stop", "--timeout", "60", container], { timeoutMs: 70_000 }),
          "Worker stop",
        );
        const timer = setTimeout(child.stop, 5_000);
        try {
          requireSuccess(await child.done, "Worker drain");
        } finally {
          clearTimeout(timer);
        }
      } finally {
        // --rm normally removes it; force removal also handles a failed stop.
        try {
          await command("docker", ["rm", "--force", container]);
        } finally {
          child.stop();
          await child.done.catch(() => {});
        }
      }
    },
  };
}

export async function withCleanup(action: () => Promise<void>, cleanup: () => Promise<void>) {
  try {
    await action();
  } catch (error) {
    try {
      await cleanup();
    } catch {
      console.error("Smoke resource cleanup also failed.");
    }
    throw error;
  }
  await cleanup();
}
