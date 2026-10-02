import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const [summitArgument, fixturePath, webOrigin] = process.argv.slice(2);
assert.ok(
  summitArgument && fixturePath && webOrigin,
  "Expected Summit, producer fixture and web origin",
);
const summitDir = resolve(summitArgument);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const pinned = (await readFile(join(repoRoot, ".summit-ref"), "utf8")).trim();
const revision = await promisify(execFile)("git", ["-C", summitDir, "rev-parse", "HEAD"]);
assert.match(pinned, /^[0-9a-f]{40}$/u);
assert.equal(revision.stdout.trim(), pinned, "The consumer must use the pinned Summit revision");
Object.assign(process.env, {
  NODE_ENV: "test",
  TZ: "Asia/Tokyo",
  DISCORD_TOKEN: "contract-only-no-login",
  DATABASE_URL: "postgres://unused:unused@127.0.0.1:1/unused",
  SUMMIT_CONFIG_YAML: await readFile(join(summitDir, "summit.config.example.yml"), "utf8"),
});
const source = (path) => pathToFileURL(join(summitDir, "src", path)).href;
const { validateNewNotification } = await import(source("domain/resultNotificationPayload.ts"));
const { assertNewNotificationPartLimit, planResultNotification } = await import(
  source("features/result-notifications/render.ts")
);
const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
assert.equal(fixture.schemaVersion, 1);
assert.equal(typeof fixture.body, "string");
assert.equal(Buffer.byteLength(fixture.body), fixture.wireBytes);
assert.ok(fixture.wireBytes <= 512 * 1024);
assert.ok(fixture.jsonbBytes > fixture.wireBytes && fixture.jsonbBytes <= 256 * 1024);
const input = JSON.parse(fixture.body);
const notification = validateNewNotification(input);
assert.deepEqual(
  notification,
  input,
  "Consumer validation must preserve the complete producer snapshot",
);
assert.equal(notification.kind, "analysis_completed");
assert.equal(notification.data.matches.length, 50);
assert.equal(notification.data.seasons.length, 16);
const points = (text, limit) => assert.equal([...text].length, limit);
points(notification.data.gameTitleName, 256);
for (const rank of notification.data.overall) points(rank.displayName, 32);
for (const season of notification.data.seasons) {
  points(season.seasonName, 256);
  for (const rank of season.ranks) points(rank.displayName, 32);
}
for (const match of notification.data.matches) {
  points(match.mapName, 256);
  points(match.seasonName, 256);
  points(match.ownerName, 32);
  points(match.note, 150);
  for (const player of match.players) points(player.displayName, 32);
}
assertNewNotificationPartLimit(notification, webOrigin);
const plan = planResultNotification(notification, webOrigin);
const parts = [...plan.parts()];
assert.equal(parts.length, plan.partCount);
assert.ok(parts.length > 1 && parts.length <= 128);
for (const part of parts) assert.ok(part.content.length <= 2_000);
const rendered = parts.map((part) => part.content).join("\n");
for (const match of notification.data.matches) {
  assert.ok(rendered.includes(`/matches/${encodeURIComponent(match.matchId)}`));
}
console.log("Analysis producer snapshot passes pinned Summit validation and bounded rendering.");
