// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  heldEventStandings,
  toHeldEventListRows,
} from "@/features/heldEvents/list/heldEventsListPresentation";
import { makeHeldEventListItem } from "@/test/factories";

describe("heldEventStandings", () => {
  it("orders players by average rank and lets ties share a standing in canonical order", () => {
    const standings = heldEventStandings([
      { averageRank: 2.5, memberId: "member_otaka", rankCounts: [0, 1, 1, 0] },
      { averageRank: 1.5, memberId: "member_akane_mami", rankCounts: [1, 1, 0, 0] },
      { averageRank: 2.5, memberId: "member_eu", rankCounts: [0, 1, 1, 0] },
      { averageRank: 3.5, memberId: "member_ponta", rankCounts: [0, 0, 1, 1] },
    ]);

    expect(
      standings.map(({ averageLabel, displayName, standing }) => [
        standing,
        displayName,
        averageLabel,
      ]),
    ).toEqual([
      [1, "あかねまみ", "1.50"],
      [2, "いーゆー", "2.50"],
      [2, "おーたか", "2.50"],
      [4, "ぽんた", "3.50"],
    ]);
  });

  it("is empty when the event has no confirmed match", () => {
    expect(heldEventStandings([])).toEqual([]);
  });
});

describe("toHeldEventListRows", () => {
  it("marks only the overall latest event, wherever it appears", () => {
    const rows = toHeldEventListRows(
      [
        makeHeldEventListItem({ id: "held-old" }),
        makeHeldEventListItem({ id: "held-latest", matchCount: 1 }),
      ],
      "held-latest",
    );

    expect(rows.map(({ id, latest, ocrHref }) => ({ id, latest, ocrHref }))).toEqual([
      { id: "held-old", latest: false, ocrHref: undefined },
      { id: "held-latest", latest: true, ocrHref: "/ocr/new?heldEventId=held-latest" },
    ]);
    expect(rows.map(({ deletable }) => deletable)).toEqual([true, false]);
  });

  it("labels the first matching note by its match number", () => {
    const [row] = toHeldEventListRows(
      [
        makeHeldEventListItem({
          noteMatch: {
            matchId: "m-3",
            matchNoInEvent: 3,
            noteBody: "ボンビー",
            otherMatchCount: 2,
          },
        }),
      ],
      undefined,
    );

    expect(row?.noteMatch).toEqual({
      matchNoLabel: "第3試合",
      noteBody: "ボンビー",
      otherMatchCount: 2,
    });
  });
});
