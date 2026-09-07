import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  RouteSuspenseFallback,
  routeFrameWidth,
  routeLoadingPresentation,
  routeTerminalPresentation,
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
    ["/matches"],
    ["/held-events"],
    ["/matches/new"],
    ["/review/session-1"],
    ["/matches/match-1/edit"],
    ["/ocr/new"],
    ["/analytics/series"],
    ["/admin/analysis"],
    ["/admin/masters"],
    ["/admin/accounts"],
    ["/exports"],
  ])("omits the page-header slot for %s", (pathname) => {
    expect(routeLoadingPresentation(pathname).header).toBeUndefined();
    expect(routeTerminalPresentation(pathname).preserveHeader).not.toBe(true);
  });

  it.each([["/matches/match-1"], ["/held-events/held-1"]])(
    "preserves the resource-detail header for %s",
    (pathname) => {
      expect(routeLoadingPresentation(pathname).header).toBeDefined();
      expect(routeTerminalPresentation(pathname).preserveHeader).toBe(true);
    },
  );

  it("moves route-known actions into the content toolbar", () => {
    expect(routeLoadingPresentation("/matches").contentToolbar).toEqual({
      actionLayout: "responsive-grid",
      actionSize: "sm",
      actionSlots: 2,
      actionWidths: ["standard", "wide"],
    });
    expect(routeLoadingPresentation("/matches/match-1/edit").contentToolbar).toEqual({
      actionSize: "sm",
      actionSlots: 1,
      actionWidths: ["long"],
    });
  });

  it.each([
    ["", false],
    ["?returnTo=%2Fmatches%3Fstatus%3Dconfirmed%23latest", true],
    ["?returnTo=https%3A%2F%2Fexample.com%2Foutside", false],
    ["?returnTo=%2F%2Fexample.com%2Foutside", false],
  ])("reserves a return slot only for a safe internal destination", (search, expected) => {
    const presentation = routeLoadingPresentation("/exports", search);

    expect(Boolean(presentation.leadingActionSlot)).toBe(expected);
  });

  it("keeps query-driven content actions separate from leading navigation", () => {
    const presentation = routeLoadingPresentation(
      "/analytics/series",
      "?returnTo=%2Fmatches%2Fmatch-1",
    );

    expect(presentation.contentToolbar?.actionSlots).toBe(1);
    expect(presentation.leadingActionSlot).toBeUndefined();
  });

  it("reserves the settings return notice after the header", () => {
    const presentation = routeLoadingPresentation(
      "/admin/masters",
      "?returnTo=%2Freview%2Fsession-1",
    );

    expect(presentation.contextNoticeSlot).toBe(true);
  });

  it("keeps the master-workspace handoff on terminal return navigation", () => {
    const presentation = routeTerminalPresentation(
      "/admin/masters",
      "?returnTo=%2Freview%2Fsession-1%3Fsample%3D1&handoffId=handoff-1",
    );

    expect(presentation.contextNavigation).toEqual({
      href: "/review/session-1?sample=1&handoffId=handoff-1",
      label: "元の画面へ戻る",
    });
  });

  it.each([
    ["/matches/new", "", "headerNavigation", "/matches", "入力をやめる", undefined],
    [
      "/matches/match-1/edit",
      "",
      "headerNavigation",
      "/matches/match-1",
      "編集をやめる",
      undefined,
    ],
    ["/matches/match-1", "", "leadingNavigation", "/matches", "前の画面へ戻る", undefined],
    ["/held-events/held-1", "", "leadingNavigation", "/held-events", "開催履歴へ戻る", undefined],
    [
      "/analytics/series",
      "?returnTo=%2Fmatches%2Fmatch-1",
      "headerNavigation",
      "/matches/match-1",
      "前の画面へ戻る",
      "back",
    ],
    [
      "/admin/masters",
      "?returnTo=%2Freview%2Fsession-1",
      "contextNavigation",
      "/review/session-1",
      "元の画面へ戻る",
      undefined,
    ],
  ] as const)(
    "maps %s terminal navigation without reclassifying the route",
    (pathname, search, placement, href, label, icon) => {
      const presentation = routeTerminalPresentation(pathname, search);

      expect(presentation[placement]).toEqual({ href, ...(icon ? { icon } : {}), label });
    },
  );

  it("does not misclassify match creation as a match detail", () => {
    const presentation = routeTerminalPresentation("/matches/new");

    expect(presentation.leadingNavigation).toBeUndefined();
    expect(presentation.headerNavigation).toEqual({ href: "/matches", label: "入力をやめる" });
  });

  it("keeps static route navigation actions in terminal states", () => {
    const matches = routeTerminalPresentation("/matches", "?status=confirmed");
    expect(matches.headerActions).toEqual({
      items: [
        {
          href: "/ocr/new?returnTo=%2Fmatches%3Fstatus%3Dconfirmed",
          icon: "scan",
          label: "OCR取り込み",
          size: "sm",
        },
        {
          href: "/matches/new?returnTo=%2Fmatches%3Fstatus%3Dconfirmed",
          icon: "manual",
          label: "手入力で作成",
          size: "sm",
        },
      ],
      label: "試合を登録",
      layout: "responsive-grid",
    });

    const detail = routeTerminalPresentation(
      "/matches/match%201",
      "?returnTo=%2Fheld-events%2Fheld-1",
    );
    expect(detail.headerActions?.items).toEqual([
      {
        href: "/exports?matchId=match+1&returnTo=%2Fmatches%2Fmatch%25201%3FreturnTo%3D%252Fheld-events%252Fheld-1",
        label: "この試合を出力",
      },
      {
        href: "/matches/match%201/edit?returnTo=%2Fmatches%2Fmatch%25201%3FreturnTo%3D%252Fheld-events%252Fheld-1",
        label: "編集",
      },
    ]);

    const heldEvent = routeTerminalPresentation("/held-events/held-1");
    expect(heldEvent.headerActions).toEqual({
      items: [
        {
          href: "/matches?heldEventId=held-1&sort=match_no_asc&returnTo=%2Fheld-events%2Fheld-1",
          icon: "filter",
          label: "試合検索で見る",
          size: "sm",
          variant: "quiet",
        },
        {
          href: "/exports?heldEventId=held-1&format=csv&returnTo=%2Fheld-events%2Fheld-1",
          icon: "download",
          label: "CSV出力",
          size: "sm",
          variant: "quiet",
        },
      ],
      label: "この開催の関連操作",
      layout: "responsive-lead",
      semantics: "navigation",
    });
  });

  it.each([
    ["/matches/new"],
    ["/review/session-1"],
    ["/matches/match-1/edit"],
    ["/admin/accounts"],
    ["/admin/analysis"],
  ])("omits page-title descriptions from loading and terminal states for %s", (path) => {
    expect(routeLoadingPresentation(path).header).toBeUndefined();
    expect(routeTerminalPresentation(path).description).toBeUndefined();
    expect(routeTerminalPresentation(path).eyebrow).toBeUndefined();
  });

  it("keeps route-specific terminal chrome and content density", () => {
    const heldEvent = routeTerminalPresentation("/held-events/held-1");
    expect(heldEvent.eyebrow).toBe("開催記録");
    expect(heldEvent.description).toBe("試合数・下書き数は未取得です。");
    expect(routeTerminalPresentation("/exports").contentPadding).toBe("compact");
  });

  it("keeps query-known sample status in loading and terminal content toolbars", () => {
    const search = "?sample=1";
    const expected = {
      label: "サンプルの読み取り結果で表示中",
      tone: "warning",
    };

    expect(routeLoadingPresentation("/review/session-1", search).contentToolbar?.status).toEqual(
      expected,
    );
    expect(routeTerminalPresentation("/review/session-1", search).descriptionStatus).toEqual(
      expected,
    );

    render(<RouteSuspenseFallback pathname="/review/session-1" search={search} />);
    expect(screen.getByText(expected.label)).toBeInTheDocument();
  });

  it("rejects an external terminal return destination", () => {
    const presentation = routeTerminalPresentation(
      "/analytics/series",
      "?returnTo=https%3A%2F%2Fexample.com%2Foutside",
    );

    expect(presentation.headerNavigation).toBeUndefined();
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
