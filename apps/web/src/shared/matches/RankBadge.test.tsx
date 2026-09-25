import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RankBadge, RankTrail } from "@/shared/matches/RankBadge";

describe("RankBadge", () => {
  it("communicates every rank without relying on color", () => {
    render(
      <>
        {[1, 2, 3, 4].map((rank) => (
          <RankBadge key={rank} rank={rank} />
        ))}
      </>,
    );
    for (const label of ["1位", "2位", "3位", "4位"]) {
      expect(screen.getByText(label)).toBeVisible();
    }
  });

  it("renders an accessible, text-backed rank trail", () => {
    render(<RankTrail ariaLabel="順位推移" ranks={[1, 3, 1]} />);

    const trail = screen.getByRole("list", { name: "順位推移" });
    const entries = within(trail).getAllByRole("listitem");
    expect(entries).toHaveLength(3);
    expect(entries[0]).toHaveTextContent("1位");
    expect(entries[1]).toHaveTextContent("3位");
    expect(entries[2]).toHaveTextContent("1位");
  });
});
