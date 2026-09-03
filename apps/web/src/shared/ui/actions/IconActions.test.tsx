import { render, screen } from "@testing-library/react";
import { ArrowRight, RefreshCw } from "lucide-react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { IconButton } from "@/shared/ui/actions/IconButton";
import { IconLink } from "@/shared/ui/actions/IconLink";
import { LinkButton } from "@/shared/ui/actions/LinkButton";

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

  it("keeps compact icon-only actions at least 44px for every pointer", () => {
    render(<IconButton aria-label="一覧を更新" icon={<RefreshCw />} size="sm" />);

    const button = screen.getByRole("button", { name: "一覧を更新" });
    expect(button).toHaveClass("size-11");
    expect(button).not.toHaveClass("sm:size-10", "pointer-fine:size-10");
  });

  it("keeps icon navigation as a link and removes navigation when disabled", () => {
    const { rerender } = render(
      <MemoryRouter>
        <IconLink
          aria-label="試合結果へ"
          icon={<ArrowRight aria-label="右矢印" />}
          to="/matches/1"
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: "試合結果へ" })).toHaveAttribute("href", "/matches/1");

    rerender(
      <MemoryRouter>
        <IconLink disabled aria-label="試合結果へ" icon={<ArrowRight />} to="/matches/1" />
      </MemoryRouter>,
    );

    const disabledLink = screen.getByRole("link", { name: "試合結果へ" });
    expect(disabledLink).toHaveAttribute("aria-disabled", "true");
    expect(disabledLink).not.toHaveAttribute("href");
  });

  it("keeps derived icon-button state authoritative over unsafely forwarded attributes", () => {
    const unsafeNativeProps = { "aria-busy": "false" } as const;
    render(
      // @ts-expect-error -- verifies the public API rejects this override while exercising the runtime guard for untyped callers.
      <IconButton
        {...unsafeNativeProps}
        aria-label="一覧を更新"
        icon={<RefreshCw />}
        pending
        pendingLabel="一覧を更新中"
        type="submit"
      />,
    );

    const button = screen.getByRole("button", { name: "一覧を更新中" });
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("type", "submit");
  });

  it("keeps supplied icons out of icon and text action names", () => {
    render(
      <MemoryRouter>
        <IconButton aria-label="一覧を更新" icon={<RefreshCw aria-label="更新アイコン" />} />
        <LinkButton icon={<ArrowRight aria-label="右矢印" />} to="/matches/1">
          試合結果へ
        </LinkButton>
      </MemoryRouter>,
    );

    expect(screen.getByRole("button", { name: "一覧を更新" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "試合結果へ" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /更新アイコン/u })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /右矢印/u })).not.toBeInTheDocument();
  });
});
