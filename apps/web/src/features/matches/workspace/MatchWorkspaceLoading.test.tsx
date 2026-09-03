import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MatchWorkspaceLoading } from "@/features/matches/workspace/MatchWorkspaceLoading";

describe("MatchWorkspaceLoading", () => {
  it("reserves the persistent header action slot while loading", () => {
    render(<MatchWorkspaceLoading />);

    const heading = screen.getByRole("heading", { name: "試合フォームを読み込み中" });
    const header = heading.closest("header");
    expect(header?.children).toHaveLength(2);
    expect(header?.children.item(1)?.firstElementChild).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
