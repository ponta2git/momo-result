import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MatchListStatusSummary } from "@/features/matches/list/MatchListStatusSummary";
import type { MatchListItemView } from "@/features/matches/list/matchListTypes";

const processingItem = {
  canCancelOcr: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  displayStatus: "ocr",
  hasWarnings: false,
  id: "draft-1",
  kind: "match_draft",
  primaryAction: { label: "状態を確認" },
  ranks: [],
  secondaryActions: [],
  status: "ocr_running",
  statusDescription: "画像を読み取っています。",
  statusLabel: "処理中",
  updatedAt: "2026-01-01T00:00:00.000Z",
} satisfies MatchListItemView;

describe("MatchListStatusSummary", () => {
  it("keeps the live status mounted while its value changes", () => {
    const { rerender } = render(<MatchListStatusSummary item={processingItem} />);
    const liveStatus = screen.getByRole("status");

    rerender(
      <MatchListStatusSummary
        item={{
          ...processingItem,
          canCancelOcr: false,
          displayStatus: "confirmed",
          kind: "match",
          status: "confirmed",
          statusDescription: "",
          statusLabel: "確定済",
        }}
      />,
    );

    expect(screen.getByRole("status")).toBe(liveStatus);
    expect(liveStatus).toHaveTextContent("確定済");
    expect(liveStatus).not.toHaveAttribute("aria-busy");
  });
});
