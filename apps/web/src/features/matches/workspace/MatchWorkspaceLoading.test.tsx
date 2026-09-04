import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MatchWorkspaceLoading } from "@/features/matches/workspace/MatchWorkspaceLoading";

describe("MatchWorkspaceLoading", () => {
  it("reserves the persistent content action slot while loading", () => {
    render(<MatchWorkspaceLoading sample />);

    const surface = screen.getByRole("region", { name: "試合内容" });
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
    expect(within(surface).getByText("サンプルの読み取り結果で表示中")).toBeVisible();
    expect(surface.firstElementChild).toHaveClass("justify-between");
    expect(surface.firstElementChild?.lastElementChild).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
