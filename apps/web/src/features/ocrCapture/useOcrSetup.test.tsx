import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import type { SetupFormValues } from "@/features/ocrCapture/schema";
import { SetupPanel } from "@/features/ocrCapture/SetupPanel";
import { useOcrSetup } from "@/features/ocrCapture/useOcrSetup";
import { heldEventKeys, masterKeys } from "@/shared/api/queryKeys";
import { createDeferred } from "@/test/deferred";
import { makeHeldEventResponse } from "@/test/factories/heldEvents";
import { setupMsw } from "@/test/msw/lifecycle";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/queryClient";
import { selectOption } from "@/test/selectOption";

setupMsw();

const gameTitle = {
  createdAt: "2026-01-01T00:00:00.000Z",
  displayOrder: 1,
  id: "gt_momotetsu_2",
  layoutFamily: "momotetsu_2",
  name: "桃太郎電鉄2",
};

const mapMaster = {
  createdAt: "2026-01-01T00:00:00.000Z",
  displayOrder: 1,
  gameTitleId: gameTitle.id,
  id: "map_east",
  name: "東日本編",
};

const seasonMaster = {
  createdAt: "2026-01-01T00:00:00.000Z",
  displayOrder: 1,
  gameTitleId: gameTitle.id,
  id: "season_current",
  name: "今シーズン",
};

function SetupOptionsHarness({ initialValue }: { initialValue: SetupFormValues }) {
  const setup = useOcrSetup({
    enabled: true,
    initialValue,
  });
  const { options, value } = setup;

  return (
    <>
      <SetupPanel model={setup.panel} />
      <output
        aria-label="setup value"
        data-error={options.heldEventsError ?? ""}
        data-refreshing={options.refreshing}
      >
        {JSON.stringify(value)}
      </output>
      <button type="button" onClick={options.retry}>
        選択肢を再取得
      </button>
      <button type="button" disabled={setup.resolution.kind !== "ready"}>
        読み取りを開始
      </button>
    </>
  );
}

function readSetupValue(): SetupFormValues {
  return JSON.parse(screen.getByLabelText("setup value").textContent ?? "{}") as SetupFormValues;
}

describe("useOcrSetup", () => {
  it.each(["map", "season"] as const)(
    "keeps OCR unavailable when the selected %s no longer exists, and recovers on reload",
    async (missing) => {
      const user = userEvent.setup();
      const queryClient = createTestQueryClient();
      queryClient.setQueryDefaults(masterKeys.all(), { staleTime: Number.POSITIVE_INFINITY });
      queryClient.setQueryData(masterKeys.gameTitles.list(), { items: [gameTitle] });
      queryClient.setQueryData(masterKeys.mapMasters.list(gameTitle.id), {
        items: missing === "map" ? [] : [mapMaster],
      });
      queryClient.setQueryData(masterKeys.seasonMasters.list(gameTitle.id), {
        items: missing === "season" ? [] : [seasonMaster],
      });
      server.use(
        http.get("/api/map-masters", () => HttpResponse.json({ items: [mapMaster] })),
        http.get("/api/season-masters", () => HttpResponse.json({ items: [seasonMaster] })),
        http.get("/api/game-titles", () => HttpResponse.json({ items: [gameTitle] })),
      );

      render(
        <QueryClientProvider client={queryClient}>
          <SetupOptionsHarness
            initialValue={{
              gameTitleId: gameTitle.id,
              mapMasterId: mapMaster.id,
              ownerMemberId: "member_ponta",
              seasonMasterId: seasonMaster.id,
            }}
          />
        </QueryClientProvider>,
      );

      expect(screen.getByRole("button", { name: "読み取りを開始" })).toBeDisabled();
      expect(readSetupValue().mapMasterId).toBe(mapMaster.id);
      expect(readSetupValue().seasonMasterId).toBe(seasonMaster.id);
      await user.click(screen.getByRole("button", { name: "選択肢を再取得" }));
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "読み取りを開始" })).toBeEnabled(),
      );
    },
  );

  it("shares the first picker page and retries a failed request only once", async () => {
    const user = userEvent.setup();
    const requests: URLSearchParams[] = [];
    server.use(
      http.get("/api/held-events", ({ request }) => {
        requests.push(new URL(request.url).searchParams);
        return requests.length === 1 ? HttpResponse.error() : HttpResponse.json({ items: [] });
      }),
    );
    const queryClient = createTestQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <SetupOptionsHarness
          initialValue={{
            gameTitleId: gameTitle.id,
            mapMasterId: mapMaster.id,
            ownerMemberId: "member_ponta",
            seasonMasterId: seasonMaster.id,
          }}
        />
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(screen.getByLabelText("setup value")).toHaveAttribute(
        "data-error",
        "応答を受け取れませんでした。",
      ),
    );
    expect(requests).toHaveLength(1);
    expect(requests[0]?.get("page")).toBe("1");
    expect(requests[0]?.get("pageSize")).toBe("20");
    expect(requests[0]?.has("limit")).toBe(false);
    await user.click(screen.getByRole("button", { name: "選択肢を再取得" }));
    await waitFor(() =>
      expect(screen.getByLabelText("setup value")).toHaveAttribute("data-error", ""),
    );
    expect(requests).toHaveLength(2);
  });

  it("fills both missing selections from the shared directories", async () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryDefaults(masterKeys.all(), {
      staleTime: Number.POSITIVE_INFINITY,
    });
    queryClient.setQueryData(masterKeys.gameTitles.list(), { items: [gameTitle] });
    queryClient.setQueryData(masterKeys.mapMasters.list(gameTitle.id), {
      items: [mapMaster],
    });
    queryClient.setQueryData(masterKeys.seasonMasters.list(gameTitle.id), {
      items: [seasonMaster],
    });
    queryClient.setQueryData(heldEventKeys.list({ page: 1, pageSize: 20 }), { items: [] });

    render(
      <QueryClientProvider client={queryClient}>
        <SetupOptionsHarness
          initialValue={{
            gameTitleId: gameTitle.id,
            mapMasterId: "",
            ownerMemberId: "member_ponta",
            seasonMasterId: "",
          }}
        />
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(readSetupValue()).toEqual({
        gameTitleId: gameTitle.id,
        mapMasterId: mapMaster.id,
        ownerMemberId: "member_ponta",
        seasonMasterId: seasonMaster.id,
      }),
    );
  });

  it("fills the server-supplied next number for a requested held event", async () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryDefaults(["masters"], { staleTime: Number.POSITIVE_INFINITY });
    queryClient.setQueryData(masterKeys.gameTitles.list(), { items: [gameTitle] });
    queryClient.setQueryData(masterKeys.mapMasters.list(gameTitle.id), {
      items: [mapMaster],
    });
    queryClient.setQueryData(masterKeys.seasonMasters.list(gameTitle.id), {
      items: [seasonMaster],
    });
    queryClient.setQueryData(heldEventKeys.list({ page: 1, pageSize: 20 }), {
      items: [
        {
          draftCount: 2,
          heldAt: "2026-01-02T00:00:00.000Z",
          id: "held-requested",
          matchCount: 3,
          nextMatchNo: 8,
        },
      ],
    });

    render(
      <QueryClientProvider client={queryClient}>
        <SetupOptionsHarness
          initialValue={{
            gameTitleId: gameTitle.id,
            heldEventId: "held-requested",
            mapMasterId: mapMaster.id,
            ownerMemberId: "member_ponta",
            seasonMasterId: seasonMaster.id,
          }}
        />
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(readSetupValue()).toMatchObject({
        heldEventId: "held-requested",
        matchNoInEvent: 8,
      }),
    );
  });

  it("retains edits made while setup choices are refreshing", async () => {
    const user = userEvent.setup();
    const queryClient = createTestQueryClient();
    const otherMap = { ...mapMaster, id: "map_west", name: "西日本編" };
    const otherSeason = { ...seasonMaster, id: "season_previous", name: "前シーズン" };
    const heldEvent = makeHeldEventResponse({ id: "held-editing", nextMatchNo: 8 });
    queryClient.setQueryDefaults(masterKeys.all(), { staleTime: Number.POSITIVE_INFINITY });
    queryClient.setQueryDefaults(heldEventKeys.all(), { staleTime: Number.POSITIVE_INFINITY });
    queryClient.setQueryData(masterKeys.gameTitles.list(), { items: [gameTitle] });
    queryClient.setQueryData(masterKeys.mapMasters.list(gameTitle.id), {
      items: [mapMaster, otherMap],
    });
    queryClient.setQueryData(masterKeys.seasonMasters.list(gameTitle.id), {
      items: [seasonMaster, otherSeason],
    });
    queryClient.setQueryData(heldEventKeys.list({ page: 1, pageSize: 20 }), {
      items: [heldEvent],
    });
    queryClient.setQueryData(heldEventKeys.summary(heldEvent.id), heldEvent);

    const refreshStarted = createDeferred();
    const refreshResponse = createDeferred();
    server.use(
      http.get("/api/game-titles", async () => {
        refreshStarted.resolve();
        await refreshResponse.promise;
        return HttpResponse.json({ items: [gameTitle] });
      }),
      http.get("/api/map-masters", async () => {
        await refreshResponse.promise;
        return HttpResponse.json({ items: [mapMaster, otherMap] });
      }),
      http.get("/api/season-masters", async () => {
        await refreshResponse.promise;
        return HttpResponse.json({ items: [seasonMaster, otherSeason] });
      }),
      http.get("/api/held-events", async () => {
        await refreshResponse.promise;
        return HttpResponse.json({ items: [{ ...heldEvent, nextMatchNo: 9 }] });
      }),
      http.get(`/api/held-events/${heldEvent.id}/summary`, async () => {
        await refreshResponse.promise;
        return HttpResponse.json({ ...heldEvent, nextMatchNo: 9 });
      }),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <SetupOptionsHarness
          initialValue={{
            gameTitleId: gameTitle.id,
            heldEventId: heldEvent.id,
            mapMasterId: mapMaster.id,
            ownerMemberId: "member_ponta",
            seasonMasterId: seasonMaster.id,
          }}
        />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByLabelText("試合番号")).toHaveValue(8));

    try {
      await user.click(screen.getByRole("button", { name: "選択肢を再取得" }));
      await refreshStarted.promise;
      await selectOption(user, screen.getByRole("combobox", { name: "マップ" }), otherMap.id);
      await selectOption(user, screen.getByRole("combobox", { name: "シーズン" }), otherSeason.id);
      await selectOption(user, screen.getByRole("combobox", { name: "オーナー" }), "member_eu");
      await user.tripleClick(screen.getByLabelText("試合番号"));
      await user.keyboard("12");
      expect(screen.getByLabelText("試合番号")).toHaveValue(12);
    } finally {
      refreshResponse.resolve();
    }

    await waitFor(() =>
      expect(screen.getByLabelText("setup value")).toHaveAttribute("data-refreshing", "false"),
    );
    expect(readSetupValue()).toEqual({
      gameTitleId: gameTitle.id,
      heldEventId: heldEvent.id,
      mapMasterId: otherMap.id,
      matchNoInEvent: 12,
      ownerMemberId: "member_eu",
      seasonMasterId: otherSeason.id,
    });
    expect(screen.getByRole("button", { name: "読み取りを開始" })).toBeEnabled();
  });

  it("preserves the selected held event when its detail request fails transiently", async () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryDefaults(masterKeys.all(), { staleTime: Number.POSITIVE_INFINITY });
    queryClient.setQueryDefaults(heldEventKeys.all(), {
      retry: false,
      staleTime: Number.POSITIVE_INFINITY,
    });
    queryClient.setQueryData(masterKeys.gameTitles.list(), { items: [gameTitle] });
    queryClient.setQueryData(masterKeys.mapMasters.list(gameTitle.id), {
      items: [mapMaster],
    });
    queryClient.setQueryData(masterKeys.seasonMasters.list(gameTitle.id), {
      items: [seasonMaster],
    });
    queryClient.setQueryData(heldEventKeys.list({ page: 1, pageSize: 20 }), { items: [] });
    server.use(
      http.get("/api/held-events/held-requested/summary", () =>
        HttpResponse.json({ detail: "temporarily unavailable" }, { status: 500 }),
      ),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <SetupOptionsHarness
          initialValue={{
            gameTitleId: gameTitle.id,
            heldEventId: "held-requested",
            mapMasterId: mapMaster.id,
            ownerMemberId: "member_ponta",
            seasonMasterId: seasonMaster.id,
          }}
        />
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(screen.getByLabelText("setup value")).toHaveAttribute(
        "data-error",
        "応答を受け取れませんでした。",
      ),
    );
    expect(readSetupValue().heldEventId).toBe("held-requested");
  });

  it("clears the selected held event only after an authoritative 404", async () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryDefaults(masterKeys.all(), { staleTime: Number.POSITIVE_INFINITY });
    queryClient.setQueryDefaults(heldEventKeys.all(), {
      retry: false,
      staleTime: Number.POSITIVE_INFINITY,
    });
    queryClient.setQueryData(masterKeys.gameTitles.list(), { items: [gameTitle] });
    queryClient.setQueryData(masterKeys.mapMasters.list(gameTitle.id), {
      items: [mapMaster],
    });
    queryClient.setQueryData(masterKeys.seasonMasters.list(gameTitle.id), {
      items: [seasonMaster],
    });
    queryClient.setQueryData(heldEventKeys.list({ page: 1, pageSize: 20 }), { items: [] });
    server.use(
      http.get("/api/held-events/held-missing/summary", () =>
        HttpResponse.json({ detail: "not found" }, { status: 404 }),
      ),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <SetupOptionsHarness
          initialValue={{
            gameTitleId: gameTitle.id,
            heldEventId: "held-missing",
            mapMasterId: mapMaster.id,
            matchNoInEvent: 9,
            ownerMemberId: "member_ponta",
            seasonMasterId: seasonMaster.id,
          }}
        />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(readSetupValue().heldEventId).toBe(""));
    expect(readSetupValue().matchNoInEvent).toBeUndefined();
  });
});
