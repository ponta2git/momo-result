import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { IncidentKey, MatchFormValues } from "@/features/matches/workspace/matchFormTypes";
import { emptyPlayers } from "@/features/matches/workspace/matchFormTypes";
import { ScoreGrid } from "@/features/matches/workspace/scoreGrid/ScoreGrid";
import { installMatchMediaController } from "@/test/doubles/dom";
import type { MatchMediaController } from "@/test/doubles/dom";

function ScoreGridHarness({
  onPlayerChange,
}: {
  onPlayerChange: (index: number, patch: Partial<MatchFormValues["players"][number]>) => void;
}) {
  const [players, setPlayers] = useState(emptyPlayers());

  return (
    <ScoreGrid
      errorPathSet={new Set()}
      lastSyncedPlayerIndex={null}
      originalPlayers={undefined}
      players={players}
      onIncidentChange={(index, key, value) => {
        setPlayers((current) =>
          current.map((player, playerIndex) =>
            playerIndex === index
              ? {
                  ...player,
                  incidents: {
                    ...player.incidents,
                    [key]: value,
                  },
                }
              : player,
          ),
        );
      }}
      onPlayerChange={(index, patch) => {
        onPlayerChange(index, patch);
        setPlayers((current) =>
          current.map((player, playerIndex) =>
            playerIndex === index ? { ...player, ...patch } : player,
          ),
        );
      }}
      onPlayOrderChange={(index, playOrder) => {
        setPlayers((current) =>
          current.map((player, playerIndex) =>
            playerIndex === index ? { ...player, playOrder } : player,
          ),
        );
      }}
      onRequestSubmitFocus={() => undefined}
    />
  );
}

describe("ScoreGrid", () => {
  let matchMedia: MatchMediaController | undefined;

  afterEach(() => {
    matchMedia?.restore();
    matchMedia = undefined;
  });

  it("keeps a mobile signed numeric draft local until the cell is committed", async () => {
    matchMedia = installMatchMediaController(true);
    const user = userEvent.setup();
    const onPlayerChange =
      vi.fn<(index: number, patch: Partial<MatchFormValues["players"][number]>) => void>();

    render(<ScoreGridHarness onPlayerChange={onPlayerChange} />);

    const revenueInput = screen.getByRole("textbox", {
      name: "ぽんた revenueManYen",
    });

    await user.clear(revenueInput);
    await user.type(revenueInput, "-");

    expect(revenueInput).toHaveValue("-");
    expect(onPlayerChange).not.toHaveBeenCalled();

    await user.type(revenueInput, "42");

    expect(revenueInput).toHaveValue("-42");
    expect(onPlayerChange).not.toHaveBeenCalled();

    await user.tab();

    expect(onPlayerChange).toHaveBeenLastCalledWith(0, { revenueManYen: -42 });
  });

  it("normalizes mobile incident inputs with the same numeric policy as desktop", async () => {
    matchMedia = installMatchMediaController(true);
    const user = userEvent.setup();
    const incidentChanges: Array<[number, IncidentKey, number]> = [];

    function IncidentHarness() {
      const [players, setPlayers] = useState(emptyPlayers());
      return (
        <ScoreGrid
          errorPathSet={new Set()}
          lastSyncedPlayerIndex={null}
          originalPlayers={undefined}
          players={players}
          onIncidentChange={(index, key, value) => {
            incidentChanges.push([index, key, value]);
            setPlayers((current) =>
              current.map((player, playerIndex) =>
                playerIndex === index
                  ? {
                      ...player,
                      incidents: {
                        ...player.incidents,
                        [key]: value,
                      },
                    }
                  : player,
              ),
            );
          }}
          onPlayerChange={() => undefined}
          onPlayOrderChange={() => undefined}
          onRequestSubmitFocus={() => undefined}
        />
      );
    }

    render(<IncidentHarness />);

    const destinationInput = screen.getByRole("textbox", {
      name: "ぽんた destination",
    });

    await user.clear(destinationInput);
    await user.type(destinationInput, "a007");

    expect(destinationInput).toHaveValue("7");
    expect(incidentChanges).toHaveLength(0);

    await user.tab();

    expect(incidentChanges.at(-1)).toEqual([0, "destination", 7]);
  });
});
