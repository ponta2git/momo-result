import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  RouteSuspenseFallback,
  routeFrameWidth,
  routeLoadingPresentation,
} from "@/app/RouteSuspenseFallback";

describe("RouteSuspenseFallback", () => {
  it.each([
    ["/exports", "narrow"],
    ["/matches", "standard"],
    ["/analytics/series", "wide"],
    ["/matches/new", "workspace"],
  ] as const)("maps %s to the ready route width", (pathname, width) => {
    expect(routeFrameWidth(pathname)).toBe(width);
  });

  it("can provide the root main landmark", () => {
    render(<RouteSuspenseFallback asMain pathname="/" />);

    const main = screen.getByRole("main");
    expect(main).toHaveAttribute("aria-busy", "true");
    expect(main).toHaveAttribute("id", "main-content");
  });

  it.each([
    [
      "/matches",
      "?returnTo=%2Fheld-events%2Fheld-1",
      { actionSize: "sm", actionSlots: 2, description: false, eyebrow: false },
      true,
    ],
    [
      "/held-events/held-1",
      "",
      { actionSize: "sm", actionSlots: 3, description: true, eyebrow: true },
      true,
    ],
    [
      "/matches/match-1/edit",
      "",
      { actionSize: "sm", actionSlots: 1, description: true, eyebrow: false },
      false,
    ],
    ["/admin/masters", "", { actionSlots: 0, description: false, eyebrow: true }, false],
    ["/admin/accounts", "", { actionSlots: 0, description: true, eyebrow: true }, false],
  ] as const)(
    "preserves the ready header and leading-slot shape for %s",
    (pathname, search, header, leadingActionSlot) => {
      const presentation = routeLoadingPresentation(pathname, search);
      expect(presentation.header).toEqual(header);
      expect(Boolean(presentation.leadingActionSlot)).toBe(leadingActionSlot);
    },
  );

  it.each([
    ["", false],
    ["?returnTo=%2Fmatches%3Fstatus%3Dconfirmed%23latest", true],
    ["?returnTo=https%3A%2F%2Fexample.com%2Foutside", false],
    ["?returnTo=%2F%2Fexample.com%2Foutside", false],
  ])("reserves a return slot only for a safe internal destination", (search, expected) => {
    const presentation = routeLoadingPresentation("/exports", search);

    expect(Boolean(presentation.leadingActionSlot)).toBe(expected);
  });

  it("keeps query-driven header actions separate from leading navigation", () => {
    const presentation = routeLoadingPresentation(
      "/analytics/series",
      "?returnTo=%2Fmatches%2Fmatch-1",
    );

    expect(presentation.header.actionSlots).toBe(1);
    expect(presentation.leadingActionSlot).toBeUndefined();
  });

  it("reserves the settings return notice after the header", () => {
    const presentation = routeLoadingPresentation(
      "/admin/masters",
      "?returnTo=%2Freview%2Fsession-1",
    );

    expect(presentation.contextNoticeSlot).toBe(true);
  });

  it("normalizes a trailing route slash before selecting the layout", () => {
    expect(routeLoadingPresentation("/matches/")).toEqual(routeLoadingPresentation("/matches"));
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
