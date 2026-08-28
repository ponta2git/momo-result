import { createHash, randomUUID } from "node:crypto";

import { expect, test as base } from "@playwright/test";
import type {
  APIRequestContext,
  APIResponse,
  Page,
  Request,
  Route,
  TestInfo,
} from "@playwright/test";

export const devAccountId = "account_ponta";
export const devUserStorageKey = "momoresult.devUser";

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
  let idempotencySequence = 0;

  return {
    registry,
    run: {
      masterIdSuffix,
      nextIdempotencyKey: (operation) => {
        idempotencySequence += 1;
        const operationSlug =
          operation
            .toLowerCase()
            .replaceAll(/[^a-z0-9]+/gu, "-")
            .replaceAll(/^-|-$/gu, "")
            .slice(0, 32) || "mutation";
        return `e2e-${masterIdSuffix}-${idempotencySequence.toString(36)}-${operationSlug}`;
      },
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

  for (const draftId of registry.draftIds.toReversed()) {
    await cleanupMutation(
      "POST",
      `/api/match-drafts/${encodeURIComponent(draftId)}/cancel`,
      `draft ${draftId}`,
    );
  }
  for (const matchId of registry.matchIds.toReversed()) {
    await cleanupMutation(
      "DELETE",
      `/api/matches/${encodeURIComponent(matchId)}`,
      `match ${matchId}`,
    );
  }
  for (const heldEventId of registry.heldEventIds.toReversed()) {
    await cleanupMutation(
      "DELETE",
      `/api/held-events/${encodeURIComponent(heldEventId)}`,
      `held event ${heldEventId}`,
    );
  }
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
  return (await response.json()) as Record<string, unknown>;
}

export async function expectOk(response: APIResponse, label: string): Promise<void> {
  if (response.ok()) return;
  throw new Error(`${label} failed with ${response.status()}: ${await response.text()}`);
}

export async function installE2eAuthHeaders(page: Page): Promise<void> {
  // Runtime E2E exercises the built web bundle, where import.meta.env.DEV is false.
  // Inject the dev auth contract at the browser boundary instead of relying on localStorage.
  await page.route("**/api/**", continueWithE2eAuth);
}

export async function continueWithE2eAuth(route: Route): Promise<void> {
  await route.continue({ headers: e2eAuthHeaders(route.request()) });
}

export async function continueWithE2eNonAdminAuth(route: Route): Promise<void> {
  await route.continue({ headers: e2eAuthHeaders(route.request(), "account_eu") });
}

export function e2eAuthHeaders(
  request: Request,
  accountId: string = devAccountId,
): Record<string, string> {
  const headers = {
    ...request.headers(),
    "X-Momo-Account-Id": accountId,
  };
  if (["DELETE", "PATCH", "POST", "PUT"].includes(request.method())) {
    headers["X-CSRF-Token"] = "dev";
  }
  return headers;
}

export function expectGeneratedId(value: string | undefined, label: string): string {
  expect(typeof value).toBe("string");
  if (typeof value !== "string") {
    throw new TypeError(`Expected ${label}, but received ${String(value)}`);
  }
  expect(value).toEqual(expect.stringMatching(generatedIdPattern));
  return value;
}

export async function expectNoHorizontalPageOverflow(page: Page): Promise<void> {
  const geometry = await page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const isClippedByAncestor = (element: Element) => {
      let ancestor = element.parentElement;
      while (ancestor && ancestor !== document.body) {
        const overflowX = window.getComputedStyle(ancestor).overflowX;
        const ancestorRect = ancestor.getBoundingClientRect();
        const clipsWithinViewport =
          ancestorRect.left >= -1 && ancestorRect.right <= viewportWidth + 1;
        if (clipsWithinViewport && ["auto", "clip", "hidden", "scroll"].includes(overflowX)) {
          return true;
        }
        ancestor = ancestor.parentElement;
      }
      return false;
    };
    const offenders = [...document.body.querySelectorAll("*")]
      .flatMap((element) => {
        const rect = element.getBoundingClientRect();
        if (
          rect.width <= 0 ||
          (rect.left >= -1 && rect.right <= viewportWidth + 1) ||
          isClippedByAncestor(element)
        ) {
          return [];
        }
        const ancestry = [];
        let current: Element | null = element;
        while (current && ancestry.length < 12) {
          const currentRect = current.getBoundingClientRect();
          const style = window.getComputedStyle(current);
          ancestry.push({
            className: current.getAttribute("class")?.slice(0, 120) ?? "",
            clientWidth: current.clientWidth,
            display: style.display,
            left: Math.round(currentRect.left),
            overflowX: style.overflowX,
            right: Math.round(currentRect.right),
            scrollWidth: current.scrollWidth,
            tag: current.tagName.toLowerCase(),
            width: Math.round(currentRect.width),
          });
          current = current.parentElement;
        }
        return [
          {
            ancestry,
            className: element.getAttribute("class")?.slice(0, 160) ?? "",
            depth: ancestry.length,
            left: Math.round(rect.left),
            right: Math.round(rect.right),
            tag: element.tagName.toLowerCase(),
            text: element.textContent?.trim().replaceAll(/\s+/gu, " ").slice(0, 100) ?? "",
            width: Math.round(rect.width),
          },
        ];
      })
      .toSorted((left, right) => right.depth - left.depth || right.right - left.right)
      .slice(0, 1);
    return {
      offenders,
      scrollWidth: document.documentElement.scrollWidth,
      viewportWidth,
    };
  });

  expect(
    geometry.scrollWidth,
    `horizontal overflow: ${JSON.stringify(geometry.offenders)}`,
  ).toBeLessThanOrEqual(geometry.viewportWidth);
}
