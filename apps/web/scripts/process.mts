import { execFile, spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

const PROCESS_STOP_TIMEOUT_MS = 10_000;
const execute = promisify(execFile);

export type CommandOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  label: string;
  signal?: AbortSignal;
  interruptSignal?: NodeJS.Signals;
};

type OwnedProcess = Pick<ChildProcess, "pid"> &
  Partial<Pick<ChildProcess, "exitCode" | "signalCode">>;

// Install once per CLI run. Keep handlers through asynchronous cleanup: a once listener
// disappears before invocation, so a later dependency's exit hook can re-send the signal.
export function createInterruptionSignal(label = "Process") {
  const controller = new AbortController();
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      if (controller.signal.aborted) return;
      process.exitCode = signal === "SIGINT" ? 130 : 143;
      controller.abort(new Error(`${label} interrupted by ${signal}.`));
    });
  }
  return controller.signal;
}

export async function stopProcessGroup(
  child: OwnedProcess | undefined,
  { signal: initialSignal = "SIGTERM" }: { signal?: NodeJS.Signals } = {},
) {
  if (!child?.pid) return;
  const target = process.platform === "win32" ? child.pid : -child.pid;
  const alive = async () => {
    if (process.platform === "win32") return child.exitCode === null && child.signalCode === null;
    // macOS can report EPERM for kill(-pgid, 0) after the last live member exits.
    // Observe only the owned group; zombies have already stopped executing.
    const { stdout } = await execute("ps", ["-e", "-o", "pgid=,stat="]);
    return stdout.split("\n").some((line) => {
      const [group, state] = line.trim().split(/\s+/u);
      return Number(group) === child.pid && state && !state.startsWith("Z");
    });
  };
  const signal = async (value: NodeJS.Signals) => {
    try {
      process.kill(target, value);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ESRCH") return;
      if (error instanceof Error && "code" in error && error.code === "EPERM" && !(await alive()))
        return;
      throw error;
    }
  };
  const waitForStop = async (timeoutMs: number) => {
    const deadline = Date.now() + timeoutMs;
    while (await alive()) {
      if (Date.now() >= deadline) return false;
      await delay(100);
    }
    return true;
  };
  // Reap the owned group, including descendants whose launcher has already exited.
  // Detached groups belong to their launcher: Playwright receives SIGINT to run its teardown.
  // Arbitrary SIGKILL of that launcher is not covered by this process-group contract.
  if (!(await alive())) return;
  await signal(initialSignal);
  if (await waitForStop(PROCESS_STOP_TIMEOUT_MS)) return;
  await signal("SIGKILL");
  if (!(await waitForStop(2_000))) throw new Error("An owned process group did not stop.");
}

export async function runCommand(
  command: string,
  args: string[],
  { cwd, env, label, signal, interruptSignal = "SIGTERM" }: CommandOptions,
) {
  signal?.throwIfAborted();
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: "inherit",
    detached: process.platform !== "win32",
  });
  let stopping: Promise<void> | undefined;
  let rejectRun: ((error: unknown) => void) | undefined;
  const interrupt = () => {
    stopping ??= stopProcessGroup(child, { signal: interruptSignal });
    void stopping.catch((error) => rejectRun?.(error));
  };
  try {
    await new Promise<void>((resolveCommand, rejectCommand) => {
      rejectRun = rejectCommand;
      child.once("error", rejectCommand);
      child.once("exit", (code, exitSignal) => {
        if (exitSignal) rejectCommand(new Error(`${label} exited after signal ${exitSignal}.`));
        else if (code === 0) resolveCommand();
        else rejectCommand(new Error(`${label} exited with code ${code ?? "unknown"}.`));
      });
      signal?.addEventListener("abort", interrupt, { once: true });
      if (signal?.aborted) interrupt();
    });
    signal?.throwIfAborted();
  } finally {
    signal?.removeEventListener("abort", interrupt);
    // A launcher may exit before its browser, server, or other forked child.
    await (stopping ?? stopProcessGroup(child));
  }
}
