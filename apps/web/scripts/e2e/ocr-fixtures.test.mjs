import assert from "node:assert/strict";
import { test } from "node:test";

import { dockerFailure } from "./ocr-fixtures.mjs";

test("Docker diagnostics distinguish bootstrap phases without carrying captured output", () => {
  const secret = "fixture-credential-must-not-appear";
  const cause = Object.assign(new Error(secret), {
    code: 125,
    signal: "SIGTERM",
    stderr: secret,
    stdout: secret,
    cmd: secret,
    cause: new Error(secret),
  });
  const failure = dockerFailure("MinIO client image", "pull", cause);
  assert.equal(
    failure.message,
    "Owned E2E Docker MinIO client image failed (phase=pull, exit=125, signal=SIGTERM).",
  );
  assert.equal(failure.cause, undefined);
  assert.doesNotMatch(String(failure.stack), new RegExp(secret, "u"));
  assert.doesNotMatch(JSON.stringify(failure), new RegExp(secret, "u"));
  assert.match(
    dockerFailure("MinIO bucket creation", "run", { code: 1 }).message,
    /phase=run, exit=1, signal=none/u,
  );
});

test("Docker diagnostics reject unexpected process metadata and retain safe launch errors", () => {
  const unknown = dockerFailure("worker", "run", {
    code: "fixture-credential-must-not-appear",
    signal: "fixture-credential-must-not-appear",
  });
  assert.match(unknown.message, /exit=unknown, signal=unknown/u);
  assert.doesNotMatch(unknown.message, /fixture-credential/u);
  assert.match(dockerFailure("worker", "run", { code: "ENOENT" }).message, /exit=ENOENT/u);
});
