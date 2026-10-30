import { resolve } from "node:path";

import { writeSessionFixtureManifest } from "./session-fixture.mts";

// CI producers build the `e2e-session-fixture` target with their own BuildKit
// cache, then bind its JAR to the Runtime image ID they have already recorded.
const [directory, runtimeImageId, ...rest] = process.argv.slice(2);
if (!directory || !runtimeImageId || rest.length > 0)
  throw new Error("Usage: record-session-fixture.mts <directory> <runtime-image-id>");
await writeSessionFixtureManifest(resolve(directory), runtimeImageId);
