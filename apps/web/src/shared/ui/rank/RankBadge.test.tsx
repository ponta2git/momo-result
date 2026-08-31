import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RankBadge, RankTrail } from "@/shared/ui/rank/RankBadge";
import {
  rankBadgeBackgroundColor,
  rankBadgeBorderColor,
  rankColor,
  rankForegroundColor,
} from "@/shared/ui/rank/rankPresentation";

describe("RankBadge", () => {
  it("keeps the ordinal text while applying the canonical rank color", () => {
    render(
      <div>
        <RankBadge rank={2} />
        <RankBadge rank={3} />
      </div>,
    );

    const second = screen.getByText("2位");
    const third = screen.getByText("3位");
    expect(second).toHaveAttribute("style", expect.stringContaining(rankBadgeBackgroundColor(2)));
    expect(second).toHaveAttribute("style", expect.stringContaining(rankBadgeBorderColor(2)));
    expect(third).toHaveAttribute("style", expect.stringContaining(rankBadgeBackgroundColor(3)));
    expect(third).toHaveAttribute("style", expect.stringContaining(rankBadgeBorderColor(3)));
    expect(second.getAttribute("style")).not.toBe(third.getAttribute("style"));
    expect(rankColor(1)).toBe("var(--color-rank-1)");
    expect(rankColor(4)).toBe("var(--color-rank-4)");
    expect(rankForegroundColor(1)).toBe("var(--color-rank-1-foreground)");
    expect(rankForegroundColor(2)).toBe("var(--color-rank-2-foreground)");
    expect(rankForegroundColor(3)).toBe("var(--color-rank-3-foreground)");
  });

  it("renders an accessible, text-backed rank trail", () => {
    render(<RankTrail ariaLabel="順位推移 1位、3位" ranks={[1, 3]} />);

    expect(screen.getByLabelText("順位推移 1位、3位")).toHaveTextContent("1位 → 3位");
  });
});
