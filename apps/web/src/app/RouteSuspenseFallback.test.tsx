import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RouteSuspenseFallback } from "@/app/RouteSuspenseFallback";

describe("RouteSuspenseFallback", () => {
  it("can provide the root main landmark", () => {
    render(<RouteSuspenseFallback asMain pathname="/" />);

    const main = screen.getByRole("main");
    expect(main).toHaveAttribute("aria-busy", "true");
    expect(main).toHaveAttribute("id", "main-content");
  });

  it.each([
    ["/analytics/series", "戦績比較を読み込んでいます"],
    ["/admin/analysis", "戦績分析管理を読み込んでいます"],
    ["/admin/masters", "設定管理を読み込んでいます"],
  ])("announces the destination while loading %s", (pathname, label) => {
    render(<RouteSuspenseFallback pathname={pathname} />);

    expect(screen.getByText(label)).toBeInTheDocument();
  });
});
