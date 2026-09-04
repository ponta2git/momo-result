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
    [
      "/matches",
      "?returnTo=%2Fheld-events%2Fheld-1",
      {
        actionLayout: "responsive-grid",
        actionSize: "sm",
        actionSlots: 2,
        actionWidths: ["standard", "wide"],
        description: false,
        eyebrow: false,
      },
      true,
    ],
    [
      "/held-events/held-1",
      "",
      {
        actionLayout: "responsive-lead",
        actionSize: "sm",
        actionSlots: 2,
        actionWidths: ["wide", "standard"],
        description: true,
        eyebrow: true,
      },
      true,
    ],
    [
      "/matches/match-1/edit",
      "",
      {
        actionSize: "sm",
        actionSlots: 1,
        actionWidths: ["long"],
        description: true,
        descriptionText: "確定済みの試合記録を編集します。保存後は一覧と出力に反映されます。",
        eyebrow: false,
      },
      false,
    ],
    ["/admin/masters", "", { actionSlots: 0, description: false, eyebrow: true }, false],
    [
      "/admin/accounts",
      "",
      {
        actionSlots: 0,
        description: true,
        descriptionText:
          "Discordでログインできるアカウントと管理者権限を管理します。試合参加者とは別に扱います。",
        eyebrow: true,
      },
      false,
    ],
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

  it("keeps static route navigation actions in terminal headers", () => {
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
    ["/matches/new", "開催と4人分の結果を入力して、確定前の確認へ進みます。"],
    [
      "/review/session-1",
      "読み取り結果を確認して、開催と4人分の結果を確定します。現在の状態: 状態不明",
    ],
    ["/matches/match-1/edit", "確定済みの試合記録を編集します。保存後は一覧と出力に反映されます。"],
    [
      "/admin/accounts",
      "Discordでログインできるアカウントと管理者権限を管理します。試合参加者とは別に扱います。",
    ],
    ["/admin/analysis", "保存済み分析の状態確認と、作品単位または全作品の再計算を行います。"],
  ])("shares the known description between loading and terminal states for %s", (path, text) => {
    expect(routeLoadingPresentation(path).header.descriptionText).toBe(text);
    expect(routeTerminalPresentation(path).description).toBe(text);
  });

  it("keeps route-specific terminal chrome and content density", () => {
    const heldEvent = routeTerminalPresentation("/held-events/held-1");
    expect(heldEvent.eyebrow).toBe("開催記録");
    expect(heldEvent.description).toBe("試合数・下書き数は未取得です。");
    expect(routeTerminalPresentation("/admin/analysis").eyebrow).toBe("管理");
    expect(routeTerminalPresentation("/exports").contentPadding).toBe("compact");
  });

  it("keeps query-known sample status in loading and terminal headers", () => {
    const search = "?sample=1";
    const expected = {
      label: "サンプルの読み取り結果で表示中",
      tone: "warning",
    };

    expect(routeLoadingPresentation("/review/session-1", search).header.descriptionStatus).toEqual(
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
