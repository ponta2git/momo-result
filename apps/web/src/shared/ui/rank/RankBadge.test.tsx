import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RankBadge, RankTrail } from "@/shared/ui/rank/RankBadge";
import { rankAverageTone, rankColor } from "@/shared/ui/rank/rankPresentation";

describe("RankBadge", () => {
  it("keeps the ordinal text while applying the canonical rank color", () => {
    render(<RankBadge rank={2} />);

    const badge = screen.getByText("2位");
    expect(badge).toHaveAttribute("style", expect.stringContaining("var(--color-rank-2)"));
    expect(rankColor(1)).toBe("var(--color-rank-1)");
    expect(rankColor(4)).toBe("var(--color-rank-4)");
  });

  it("renders an accessible, text-backed rank trail", () => {
    render(<RankTrail ariaLabel="順位推移 1位、3位" ranks={[1, 3]} />);

    expect(screen.getByLabelText("順位推移 1位、3位")).toHaveTextContent("1位 → 3位");
  });

  it("uses analysis polarity rather than operation or error colors for rank averages", () => {
    expect(rankAverageTone(1, 1, 4)).toContain("--color-analysis-positive");
    expect(rankAverageTone(4, 1, 4)).toContain("--color-analysis-negative");
    expect(rankAverageTone(1, 1, 4)).not.toContain("--color-action");
    expect(rankAverageTone(4, 1, 4)).not.toContain("--color-danger");
  });
});
