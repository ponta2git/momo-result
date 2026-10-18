import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { expect, test as base } from "@playwright/test";
import type { APIRequestContext, APIResponse, Locator, Page, TestInfo } from "@playwright/test";

import type { components } from "../src/shared/api/generated";

export const devAccountId = "account_ponta";

/** Exercise the visible selection path using the option's stable business identity. */
export async function selectControlOption(page: Page, trigger: Locator, value: string) {
  await trigger.click();
  const option = page
    .getByRole("option")
    .and(page.locator(`[data-value=${JSON.stringify(value)}]`));
  const label = await option.textContent();
  await option.click();
  await expect(trigger).toHaveText(label ?? "");
}

const generatedIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

type ResourceRegistry = {
  aliasIds: string[];
  draftIds: string[];
  gameTitleIds: string[];
  heldEventIds: string[];
  mapMasterIds: string[];
  matchIds: string[];
  seasonMasterIds: string[];
};

export type E2eRun = {
  masterIdSuffix: string;
  nextIdempotencyKey: (operation: string) => string;
  trackAlias: (id: string) => void;
  trackDraft: (id: string) => void;
  trackGameTitle: (id: string) => void;
  trackHeldEvent: (id: string) => void;
  trackMapMaster: (id: string) => void;
  trackMatch: (id: string) => void;
  trackSeasonMaster: (id: string) => void;
  uniqueLocalDateTime: (year?: number) => string;
};

export const test = base.extend<{ e2eRun: E2eRun }>({
  e2eRun: async ({ request }, provide, testInfo) => {
    const { registry, run } = createE2eRun(testInfo);
    try {
      await provide(run);
    } finally {
      await cleanupE2eRun(request, run, registry);
    }
  },
});

export { expect };

function createE2eRun(testInfo: TestInfo): { registry: ResourceRegistry; run: E2eRun } {
  const identity = [
    testInfo.project.name,
    testInfo.workerIndex,
    testInfo.parallelIndex,
    testInfo.repeatEachIndex,
    testInfo.retry,
    randomUUID(),
  ].join(":");
  const identityHash = createHash("sha256").update(identity).digest("hex");
  const masterIdSuffix = identityHash.slice(0, 18);
  const registry: ResourceRegistry = {
    aliasIds: [],
    draftIds: [],
    gameTitleIds: [],
    heldEventIds: [],
    mapMasterIds: [],
    matchIds: [],
    seasonMasterIds: [],
  };
  return {
    registry,
    run: {
      masterIdSuffix,
      nextIdempotencyKey: () => randomUUID(),
      trackAlias: (id) => trackResource(registry.aliasIds, id),
      trackDraft: (id) => trackResource(registry.draftIds, id),
      trackGameTitle: (id) => trackResource(registry.gameTitleIds, id),
      trackHeldEvent: (id) => trackResource(registry.heldEventIds, id),
      trackMapMaster: (id) => trackResource(registry.mapMasterIds, id),
      trackMatch: (id) => trackResource(registry.matchIds, id),
      trackSeasonMaster: (id) => trackResource(registry.seasonMasterIds, id),
      uniqueLocalDateTime: (year = 2026) => {
        const minutesInYear =
          (new Date(Date.UTC(year + 1, 0, 1)).getTime() -
            new Date(Date.UTC(year, 0, 1)).getTime()) /
          60_000;
        const minuteOffset = Number.parseInt(identityHash.slice(0, 12), 16) % minutesInYear;
        const value = new Date(Date.UTC(year, 0, 1, 0, minuteOffset));
        return `${value.getUTCFullYear().toString().padStart(4, "0")}-${(value.getUTCMonth() + 1)
          .toString()
          .padStart(2, "0")}-${value.getUTCDate().toString().padStart(2, "0")}T${value
          .getUTCHours()
          .toString()
          .padStart(2, "0")}:${value.getUTCMinutes().toString().padStart(2, "0")}`;
      },
    },
  };
}

function trackResource(resourceIds: string[], id: string): void {
  if (!resourceIds.includes(id)) resourceIds.push(id);
}

async function cleanupE2eRun(
  request: APIRequestContext,
  run: E2eRun,
  registry: ResourceRegistry,
): Promise<void> {
  const failures: Error[] = [];
  const cleanupMutation = async (
    method: "DELETE" | "POST",
    path: string,
    label: string,
  ): Promise<void> => {
    try {
      const headers = mutationHeaders(run, `cleanup-${label}`);
      const response =
        method === "DELETE"
          ? await request.delete(path, { headers })
          : await request.post(path, { headers });
      if (response.ok() || response.status() === 404) return;
      failures.push(
        new Error(`${label} cleanup failed with ${response.status()}: ${await response.text()}`),
      );
    } catch (error) {
      failures.push(error instanceof Error ? error : new Error(String(error)));
    }
  };

  // Deleting a confirmed match also removes its linked draft. Cancel only remaining drafts.
  for (const matchId of registry.matchIds.toReversed()) {
    await cleanupMutation(
      "DELETE",
      `/api/matches/${encodeURIComponent(matchId)}`,
      `match ${matchId}`,
    );
  }
  for (const draftId of registry.draftIds.toReversed()) {
    await cleanupMutation(
      "POST",
      `/api/match-drafts/${encodeURIComponent(draftId)}/cancel`,
      `draft ${draftId}`,
    );
  }
  for (const heldEventId of registry.heldEventIds.toReversed()) {
    await cleanupMutation(
      "DELETE",
      `/api/held-events/${encodeURIComponent(heldEventId)}`,
      `held event ${heldEventId}`,
    );
  }
  // Deleting the final match schedules analysis too. Settle owned work before
  // cascading its title/job rows, so a stale shared lease cannot affect the next case.
  let analysisSettled = true;
  for (const gameTitleId of registry.gameTitleIds) {
    try {
      await waitForAnalysisSettled(request, gameTitleId);
    } catch (error) {
      analysisSettled = false;
      failures.push(error instanceof Error ? error : new Error("Owned analysis did not settle."));
    }
  }
  if (analysisSettled) {
    for (const mapMasterId of registry.mapMasterIds.toReversed()) {
      await cleanupMutation(
        "DELETE",
        `/api/map-masters/${encodeURIComponent(mapMasterId)}`,
        `map master ${mapMasterId}`,
      );
    }
    for (const seasonMasterId of registry.seasonMasterIds.toReversed()) {
      await cleanupMutation(
        "DELETE",
        `/api/season-masters/${encodeURIComponent(seasonMasterId)}`,
        `season master ${seasonMasterId}`,
      );
    }
    for (const gameTitleId of registry.gameTitleIds.toReversed()) {
      await cleanupMutation(
        "DELETE",
        `/api/game-titles/${encodeURIComponent(gameTitleId)}`,
        `game title ${gameTitleId}`,
      );
    }
  }
  for (const aliasId of registry.aliasIds.toReversed()) {
    await cleanupMutation(
      "DELETE",
      `/api/member-aliases/${encodeURIComponent(aliasId)}`,
      `member alias ${aliasId}`,
    );
  }

  if (failures.length > 0) {
    throw new AggregateError(failures, `E2E cleanup failed for run ${run.masterIdSuffix}`);
  }
}

export async function waitForAnalysisSettled(request: APIRequestContext, gameTitleId: string) {
  const metadataPath = process.env["MOMO_E2E_METADATA"];
  if (!metadataPath) return;
  const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as {
    workerMode: "native" | "controlled";
  };
  if (metadata.workerMode === "controlled") return;
  if (metadata.workerMode !== "native") throw new Error("Unknown system Worker mode.");
  await expect
    .poll(
      async () => {
        const response = await request.get(
          `/api/analytics/series-comparison/v2/status?${new URLSearchParams({ gameTitleId })}`,
        );
        if (response.status() === 404) return "settled";
        await expectOk(response, "owned analysis settlement");
        const status =
          (await response.json()) as components["schemas"]["SeriesAnalysisStatusResponse"];
        return status.calculation?.status === "queued" || status.calculation?.status === "running"
          ? status.calculation.status
          : "settled";
      },
      { timeout: 60_000, intervals: [250, 500, 1000] },
    )
    .toBe("settled");
}

function mutationHeaders(run: E2eRun, operation: string): Record<string, string> {
  return {
    "Idempotency-Key": run.nextIdempotencyKey(operation),
    "X-CSRF-Token": "dev",
    "X-Momo-Account-Id": devAccountId,
  };
}

export async function postJson(
  request: APIRequestContext,
  run: E2eRun,
  path: string,
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await request.post(path, {
    data,
    headers: mutationHeaders(run, `post-${path}`),
  });
  await expectOk(response, path);
  return readJsonObject(response);
}

export async function readJsonObject(
  response: Pick<APIResponse, "json">,
): Promise<Record<string, unknown>> {
  const value: unknown = await response.json();
  if (!isJsonObject(value)) throw new TypeError("Expected a JSON object response.");
  return value;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function expectOk(
  response: Pick<APIResponse, "ok" | "status" | "text">,
  label: string,
): Promise<void> {
  if (response.ok()) return;
  throw new Error(`${label} failed with ${response.status()}: ${await response.text()}`);
}

export function expectGeneratedId(value: unknown, label: string): string {
  expect(typeof value).toBe("string");
  if (typeof value !== "string") {
    throw new TypeError(`Expected ${label}, but received ${String(value)}`);
  }
  expect(value).toEqual(expect.stringMatching(generatedIdPattern));
  return value;
}
