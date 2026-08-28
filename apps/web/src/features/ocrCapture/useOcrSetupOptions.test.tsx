import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { resolveHeldEventContext } from "@/features/ocrCapture/ocrSetupOptionResolution";
import type { SetupFormValues } from "@/features/ocrCapture/schema";
import { useOcrSetupOptions } from "@/features/ocrCapture/useOcrSetupOptions";
import { heldEventKeys, masterKeys } from "@/shared/api/queryKeys";
import { setupMsw } from "@/test/msw/lifecycle";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/queryClient";

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
  const [value, setValue] = useState(initialValue);
  const options = useOcrSetupOptions({
    enabled: true,
    onChange: setValue,
    value,
  });

  return (
    <output aria-label="setup value" data-error={options.heldEventsError ?? ""}>
      {JSON.stringify(value)}
    </output>
  );
}

function readSetupValue(): SetupFormValues {
  return JSON.parse(screen.getByLabelText("setup value").textContent ?? "{}") as SetupFormValues;
}

describe("useOcrSetupOptions", () => {
  it("distinguishes authoritative absence from a transient lookup failure", () => {
    const base = {
      detailFailed: true,
      directoryFailed: false,
      enabled: true,
      fetching: false,
      selected: false,
      selectedId: "held-requested",
    };

    expect(resolveHeldEventContext({ ...base, detailErrorStatus: 404 })).toBe("notFound");
    expect(resolveHeldEventContext({ ...base, detailErrorStatus: 500 })).toBe("failed");
  });

  it("applies map and season fallbacks in one state transition", async () => {
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
    queryClient.setQueryData(heldEventKeys.directory(), { items: [] });

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
    queryClient.setQueryData(heldEventKeys.directory(), {
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
    queryClient.setQueryData(heldEventKeys.directory(), { items: [] });
    server.use(
      http.get("/api/held-events/held-requested", () =>
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
    queryClient.setQueryData(heldEventKeys.directory(), { items: [] });
    server.use(
      http.get("/api/held-events/held-missing", () =>
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
