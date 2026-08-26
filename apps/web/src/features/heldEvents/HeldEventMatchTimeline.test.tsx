import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { HeldEventMatchTimeline } from "@/features/heldEvents/HeldEventMatchTimeline";
import type { HeldEventMatchResponse } from "@/shared/api/heldEvents";

const match = (matchNoInEvent: number): HeldEventMatchResponse => ({
  gameTitleId: "game-1",
  mapMasterId: "map-1",
  matchId: `match-${matchNoInEvent}`,
  matchNoInEvent,
  ownerMemberId: "member_ponta",
  playedAt: "2026-01-01T00:00:00.000Z",
  players: [],
  seasonMasterId: "season-1",
});

describe("HeldEventMatchTimeline", () => {
  it("connects marker centers without extending below the final match", () => {
    render(
      <MemoryRouter>
        <HeldEventMatchTimeline
          masterNames={{ gameTitles: new Map(), maps: new Map(), seasons: new Map() }}
          matches={[match(1), match(2), match(3)]}
          returnTo="/held-events/held-1"
        />
      </MemoryRouter>,
    );

    const timeline = screen.getByRole("list", { name: "試合の流れ" });
    const records = Array.from(timeline.children);

    expect(timeline.querySelectorAll("[data-timeline-connector]")).toHaveLength(2);
    expect(records[0]?.querySelector("[data-timeline-connector]")).toBeInTheDocument();
    expect(records[1]?.querySelector("[data-timeline-connector]")).toBeInTheDocument();
    expect(records[2]?.querySelector("[data-timeline-connector]")).toBeNull();
  });
});
