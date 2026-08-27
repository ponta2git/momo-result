import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RouteSuspenseFallback, routeLoadingPresentation } from "@/app/RouteSuspenseFallback";

describe("RouteSuspenseFallback", () => {
  it("can provide the root main landmark", () => {
    render(<RouteSuspenseFallback asMain pathname="/" />);

    const main = screen.getByRole("main");
    expect(main).toHaveAttribute("aria-busy", "true");
    expect(main).toHaveAttribute("id", "main-content");
  });

  it.each([
    ["/matches/new", { kind: "workspace", width: "workspace" }],
    ["/held-events/event-1", { kind: "detail", width: "wide" }],
    [
      "/analytics/series",
      { kind: "comparison", loadingLabel: "戦績比較を読み込んでいます", width: "wide" },
    ],
    [
      "/admin/analysis",
      { kind: "comparison", loadingLabel: "戦績分析管理を読み込んでいます", width: "wide" },
    ],
    ["/exports", { kind: "form", width: "narrow" }],
    [
      "/admin/masters",
      { kind: "catalog", loadingLabel: "設定管理を読み込んでいます", width: "standard" },
    ],
  ] as const)("maps %s in the app layer", (pathname, presentation) => {
    expect(routeLoadingPresentation(pathname)).toEqual(presentation);
  });

  it("renders the selected workspace width", () => {
    render(<RouteSuspenseFallback pathname="/matches/new" />);

    expect(screen.getByTestId("page-loading-fallback")).toHaveClass("max-w-[120rem]");
  });

  it("keeps the export fallback in the same single-column task order as the page", () => {
    render(<RouteSuspenseFallback pathname="/exports" />);

    const fallback = screen.getByTestId("page-loading-fallback");
    const operationGroup = fallback.children.item(1);
    expect(operationGroup).toHaveClass("grid", "gap-4", "rounded-[var(--radius-md)]");
    expect(operationGroup).not.toHaveClass("lg:grid-cols-[minmax(0,1fr)_minmax(20rem,28rem)]");
  });

  it.each([
    ["/analytics/series", "戦績比較を読み込んでいます"],
    ["/admin/analysis", "戦績分析管理を読み込んでいます"],
    ["/admin/masters", "設定管理を読み込んでいます"],
  ])("announces the destination while loading %s", (pathname, label) => {
    render(<RouteSuspenseFallback pathname={pathname} />);

    expect(screen.getByText(label)).toHaveClass("sr-only");
  });
});
