import { createHash } from "node:crypto";
import { lstat, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

// The runner's session fixture input: the JAR built by the root Dockerfile's
// `e2e-session-fixture` target and the Runtime image whose classes it runs on.
// CI provenance (commit, run, producer attempt) is checked before the runner.
export const sessionFixtureJar = "session-fixture.jar";
export const sessionFixtureManifest = "session-fixture.json";
const imageIdentity = /^sha256:[0-9a-f]{64}$/u;

async function regularFile(path: string) {
  if (!(await lstat(path)).isFile())
    throw new Error("Session fixture inputs must be regular files.");
  return readFile(path);
}

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Records the JAR hash and the Runtime image ID that supplies its classpath. */
export async function writeSessionFixtureManifest(directory: string, runtimeImageId: string) {
  if (!imageIdentity.test(runtimeImageId)) throw new Error("Invalid Runtime image identity.");
  const jarSha256 = sha256(await regularFile(join(directory, sessionFixtureJar)));
  await writeFile(
    join(directory, sessionFixtureManifest),
    `${JSON.stringify({ schemaVersion: 1, runtimeImageId, jarSha256 })}\n`,
    { flag: "wx", mode: 0o644 },
  );
}

/**
 * Returns the verified JAR bytes. Callers run these bytes, not the source path,
 * so a later change to the prepared directory cannot replace what was checked.
 */
export async function verifiedSessionFixture(directory: string, runtimeImageId: string) {
  const [manifestBytes, jar] = await Promise.all([
    regularFile(join(directory, sessionFixtureManifest)),
    regularFile(join(directory, sessionFixtureJar)),
  ]);
  let manifest: unknown;
  try {
    manifest = JSON.parse(manifestBytes.toString("utf8"));
  } catch {
    manifest = undefined;
  }
  if (
    !manifest ||
    typeof manifest !== "object" ||
    Object.keys(manifest).toSorted().join() !== "jarSha256,runtimeImageId,schemaVersion" ||
    !("schemaVersion" in manifest) ||
    manifest.schemaVersion !== 1 ||
    !("runtimeImageId" in manifest) ||
    manifest.runtimeImageId !== runtimeImageId ||
    !("jarSha256" in manifest) ||
    manifest.jarSha256 !== sha256(jar)
  )
    throw new Error(
      "Session fixture does not match the selected Runtime image; run pnpm e2e:prepare.",
    );
  return jar;
}
