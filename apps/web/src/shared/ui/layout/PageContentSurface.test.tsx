import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PageContentSurface } from "@/shared/ui/layout/PageContentSurface";

describe("PageContentSurface", () => {
  it("provides one borderless page-level content plane", () => {
    render(<PageContentSurface data-testid="surface">内容</PageContentSurface>);

    const surface = screen.getByTestId("surface");
    expect(surface).toHaveClass("bg-[var(--color-surface)]");
    expect(surface).not.toHaveClass("border");
    expect(surface).toHaveTextContent("内容");
  });

  it("can defer spacing to an embedded data layout", () => {
    render(
      <PageContentSurface data-testid="surface" padding="none">
        表
      </PageContentSurface>,
    );

    expect(screen.getByTestId("surface")).not.toHaveClass("p-4");
  });
});
