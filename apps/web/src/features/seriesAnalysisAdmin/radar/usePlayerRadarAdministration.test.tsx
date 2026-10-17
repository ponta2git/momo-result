import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { usePlayerRadarAdministration } from "@/features/seriesAnalysisAdmin/radar/usePlayerRadarAdministration";
import { getAuthorization } from "@/shared/auth/authorizationQueryAdapter";
import { setDevUser } from "@/test/auth";
import { createDeferred } from "@/test/deferred";
import { mswState } from "@/test/msw/fixtures";
import { setupMsw } from "@/test/msw/lifecycle";
import {
  makePlayerRadarOperation,
  makePlayerRadarPreview,
  makeReadyPlayerRadarState,
} from "@/test/msw/playerRadarFixtures";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/queryClient";

setupMsw();
beforeAll(
  () => import("@/shared/api/generatedContracts/series-analysis-radar-validators.generated"),
);
beforeEach(() => setDevUser());

const prepared = { candidateId: "prepared-candidate", operationId: "manual-creation" };

function stateFixture() {
  const state = makeReadyPlayerRadarState();
  state.candidate!.candidateId = prepared.candidateId;
  return state;
}

function conflict() {
  return HttpResponse.json(
    { type: "about:blank", title: "Conflict", status: 409, code: "CONFLICT" },
    { status: 409 },
  );
}

async function renderAdministration() {
  const client = createTestQueryClient();
  const hook = renderHook(() => usePlayerRadarAdministration("gt_momotetsu_2", "桃太郎電鉄2"), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  await waitFor(() => expect(hook.result.current.view?.editing?.permissionReason).toBeNull());
  return { ...hook, client };
}

describe("prepared radar edit disposal", () => {
  it.each(["replaced", "withdrawn", "applied", "application_failed"] as const)(
    "ends only the local edit after a guarded conflict and fresh proof of %s",
    async (change) => {
      const initial = stateFixture();
      const fresh = structuredClone(initial);
      if (change === "replaced") fresh.candidate!.candidateId = "another-operators-candidate";
      else if (change === "application_failed")
        fresh.operations = [
          {
            ...makePlayerRadarOperation("apply"),
            candidateId: prepared.candidateId,
            status: "failed",
          },
        ];
      else fresh.candidate!.status = change;
      let rejected = false;
      let freshReads = 0;
      const requests: unknown[] = [];
      server.use(
        http.get("/api/admin/series-analysis/radar", () => {
          if (rejected) freshReads += 1;
          return HttpResponse.json(rejected ? fresh : initial);
        }),
        http.get("/api/admin/series-analysis/radar/preview", () =>
          HttpResponse.json(makePlayerRadarPreview()),
        ),
        http.post("/api/admin/series-analysis/radar/operations", async ({ request }) => {
          requests.push(await request.json());
          rejected = true;
          return conflict();
        }),
      );
      const { result } = await renderAdministration();
      await act(async () => {
        await result.current.view!.editing!.discard(prepared);
      });
      expect(freshReads).toBe(1);
      expect(requests).toEqual([
        {
          gameTitleId: initial.gameTitleId,
          kind: "withdraw",
          candidateId: prepared.candidateId,
          originOperationId: prepared.operationId,
        },
      ]);
      expect(result.current.view?.candidate?.candidateId).toBe(fresh.candidate?.candidateId);
    },
  );

  it.each(["still_current", "missing", "network_error"] as const)(
    "retains the edit when refreshed state is %s, ignoring an older different cached candidate",
    async (outcome) => {
      const initial = stateFixture();
      initial.candidate!.candidateId = "old-candidate-before-save";
      const fresh = stateFixture();
      if (outcome === "missing") fresh.candidate = null;
      let rejected = false;
      let freshReads = 0;
      let requests = 0;
      server.use(
        http.get("/api/admin/series-analysis/radar", () => {
          if (rejected) {
            freshReads += 1;
            return outcome === "network_error" ? HttpResponse.error() : HttpResponse.json(fresh);
          }
          return HttpResponse.json(initial);
        }),
        http.get("/api/admin/series-analysis/radar/preview", () =>
          HttpResponse.json(makePlayerRadarPreview()),
        ),
        http.post("/api/admin/series-analysis/radar/operations", () => {
          requests += 1;
          rejected = true;
          return conflict();
        }),
      );
      const { result } = await renderAdministration();
      await act(async () => {
        await expect(result.current.view!.editing!.discard(prepared)).rejects.toBeDefined();
      });
      expect(requests).toBe(1);
      expect(freshReads).toBe(1);
    },
  );

  it("does not skip guarded withdrawal just because the save receipt is newer than the cached state", async () => {
    const initial = stateFixture();
    initial.candidate!.candidateId = "old-candidate-before-save";
    const requests: unknown[] = [];
    server.use(
      http.get("/api/admin/series-analysis/radar", () => HttpResponse.json(initial)),
      http.get("/api/admin/series-analysis/radar/preview", () =>
        HttpResponse.json(makePlayerRadarPreview()),
      ),
      http.post("/api/admin/series-analysis/radar/operations", async ({ request }) => {
        requests.push(await request.json());
        return HttpResponse.json(
          { ...makePlayerRadarOperation("withdraw"), candidateId: prepared.candidateId },
          { status: 202 },
        );
      }),
    );
    const { result } = await renderAdministration();
    await act(async () => {
      await result.current.view!.editing!.discard(prepared);
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      candidateId: prepared.candidateId,
      originOperationId: prepared.operationId,
    });
  });

  it("rejects a late recovery read after its authorization lease has been revoked", async () => {
    const initial = stateFixture();
    const fresh = structuredClone(initial);
    fresh.candidate!.status = "applied";
    const readStarted = createDeferred();
    const readGate = createDeferred();
    let rejected = false;
    server.use(
      http.get("/api/admin/series-analysis/radar", async () => {
        if (!rejected) return HttpResponse.json(initial);
        readStarted.resolve();
        await readGate.promise;
        return HttpResponse.json(fresh);
      }),
      http.get("/api/admin/series-analysis/radar/preview", () =>
        HttpResponse.json(makePlayerRadarPreview()),
      ),
      http.post("/api/admin/series-analysis/radar/operations", () => {
        rejected = true;
        return conflict();
      }),
    );
    const { result, client } = await renderAdministration();
    await act(async () => {
      const pending = expect(result.current.view!.editing!.discard(prepared)).rejects.toBeDefined();
      await readStarted.promise;
      mswState.loginAccounts.find((account) => account.accountId === "account_ponta")!.role =
        "user";
      await getAuthorization(client, "account_ponta").recheck();
      readGate.resolve();
      await pending;
    });
    expect(result.current.view).toBeNull();
  });
});
