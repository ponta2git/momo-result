import { render, screen } from "@testing-library/react";
import { ArrowRight, RefreshCw } from "lucide-react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { IconButton } from "@/shared/ui/actions/IconButton";
import { IconLink } from "@/shared/ui/actions/IconLink";

describe("icon actions", () => {
  it("announces and disables an icon button while pending", () => {
    render(
      <IconButton
        aria-label="一覧を更新"
        icon={<RefreshCw />}
        pending
        pendingLabel="一覧を更新中"
      />,
    );

    const button = screen.getByRole("button", { name: "一覧を更新中" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
  });

  it("keeps icon navigation as a link and removes navigation when disabled", () => {
    const { rerender } = render(
      <MemoryRouter>
        <IconLink aria-label="試合結果へ" icon={<ArrowRight />} to="/matches/1" />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: "試合結果へ" })).toHaveAttribute(
      "href",
      "/matches/1",
    );

    rerender(
      <MemoryRouter>
        <IconLink disabled aria-label="試合結果へ" icon={<ArrowRight />} to="/matches/1" />
      </MemoryRouter>,
    );

    const disabledLink = screen.getByRole("link", { name: "試合結果へ" });
    expect(disabledLink).toHaveAttribute("aria-disabled", "true");
    expect(disabledLink).not.toHaveAttribute("href");
  });
});
