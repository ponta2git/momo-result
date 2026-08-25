import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PlayOrderMark, playOrderPresentation } from "@/shared/ui/data/PlayOrderMark";

describe("PlayOrderMark", () => {
  it("pairs the play-order color with visible text", () => {
    render(<PlayOrderMark playOrder={3} />);

    const label = screen.getByText("プレー順3");
    const mark = label.parentElement?.querySelector('[aria-hidden="true"]');

    expect(label.parentElement).toHaveAttribute("data-play-order", "3");
    expect(mark).toHaveStyle({ backgroundColor: "var(--color-play-order-3)" });
  });

  it.each([0, 5, Number.NaN, undefined])(
    "uses a text-backed neutral fallback for an out-of-range value (%s)",
    (playOrder) => {
      const { unmount } = render(<PlayOrderMark playOrder={playOrder} />);

      const label = screen.getByText("プレー順不明");
      const mark = label.parentElement?.querySelector('[aria-hidden="true"]');

      expect(label.parentElement).toHaveAttribute("data-play-order", "unknown");
      expect(mark).toHaveStyle({ backgroundColor: "var(--color-border-strong)" });
      expect(playOrderPresentation(playOrder).playOrder).toBeNull();
      unmount();
    },
  );
});
