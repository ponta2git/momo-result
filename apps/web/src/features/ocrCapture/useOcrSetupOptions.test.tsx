import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import type { SetupFormValues } from "@/features/ocrCapture/schema";
import { useOcrSetupOptions } from "@/features/ocrCapture/useOcrSetupOptions";
import { masterKeys } from "@/shared/api/queryKeys";
import { createTestQueryClient } from "@/test/queryClient";

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
  useOcrSetupOptions({
    authAccountId: "account_ponta",
    enabled: true,
    onChange: setValue,
    value,
  });

  return <output aria-label="setup value">{JSON.stringify(value)}</output>;
}

function readSetupValue(): SetupFormValues {
  return JSON.parse(screen.getByLabelText("setup value").textContent ?? "{}") as SetupFormValues;
}

describe("useOcrSetupOptions", () => {
  it("applies map and season fallbacks in one state transition", async () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryDefaults(masterKeys.all(), {
      staleTime: Number.POSITIVE_INFINITY,
    });
    queryClient.setQueryData(masterKeys.gameTitles.list("account_ponta"), { items: [gameTitle] });
    queryClient.setQueryData(masterKeys.mapMasters.list("account_ponta", gameTitle.id), {
      items: [mapMaster],
    });
    queryClient.setQueryData(masterKeys.seasonMasters.list("account_ponta", gameTitle.id), {
      items: [seasonMaster],
    });

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
});
