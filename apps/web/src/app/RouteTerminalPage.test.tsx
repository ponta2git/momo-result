import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { RouteTerminalPage } from "@/app/RouteTerminalPage";

function renderTerminal(pathname: string, search = "") {
  render(
    <MemoryRouter>
      <RouteTerminalPage pathname={pathname} search={search} title="表示できません">
        <p>時間をおいて再試行してください。</p>
      </RouteTerminalPage>
    </MemoryRouter>,
  );
  return screen.getByRole("region", { name: "表示できません" });
}

describe("route terminal navigation", () => {
  it("keeps known held-event context and related actions without pretending data loaded", () => {
    renderTerminal("/held-events/held-1");

    expect(screen.getByRole("heading", { level: 1, name: "表示できません" })).toBeVisible();
    expect(screen.getByText("開催記録")).toBeVisible();
    expect(screen.getByText("試合数・下書き数は未取得です。")).toBeVisible();
    expect(screen.getByRole("link", { name: "開催履歴へ戻る" })).toHaveAttribute(
      "href",
      "/held-events",
    );
    const actions = within(screen.getByRole("navigation", { name: "この開催の関連操作" }));
    expect(actions.getByRole("link", { name: "試合検索で見る" })).toHaveAttribute(
      "href",
      "/matches?heldEventId=held-1&sort=match_no_asc&returnTo=%2Fheld-events%2Fheld-1",
    );
    expect(actions.getByRole("link", { name: "CSV出力" })).toHaveAttribute(
      "href",
      "/exports?heldEventId=held-1&format=csv&returnTo=%2Fheld-events%2Fheld-1",
    );
  });

  it("preserves an encoded match identifier and return context in detail actions", () => {
    renderTerminal("/matches/match%2Fone/", "?returnTo=%2Fmatches%3Fstatus%3Dconfirmed");

    const exportUrl = new URL(
      screen.getByRole("link", { name: "この試合を出力" }).getAttribute("href")!,
      "https://app.test",
    );
    expect(exportUrl.pathname).toBe("/exports");
    expect(exportUrl.searchParams.get("matchId")).toBe("match/one");
    expect(exportUrl.searchParams.get("returnTo")).toBe(
      "/matches/match%2Fone?returnTo=%2Fmatches%3Fstatus%3Dconfirmed",
    );
    expect(screen.getByRole("link", { name: "編集" })).toHaveAttribute(
      "href",
      "/matches/match%2Fone/edit?returnTo=%2Fmatches%2Fmatch%252Fone%3FreturnTo%3D%252Fmatches%253Fstatus%253Dconfirmed",
    );
    expect(screen.getByRole("link", { name: "前の画面へ戻る" })).toHaveAttribute(
      "href",
      "/matches?status=confirmed",
    );
  });

  it.each([
    ["/matches/new", "入力をやめる", "/matches"],
    ["/matches/match-1/edit/", "編集をやめる", "/matches/match-1"],
  ])("keeps one safe workspace exit for %s", (pathname, name, href) => {
    const surface = renderTerminal(pathname, "?returnTo=https%3A%2F%2Fexternal.test");

    expect(within(surface).getByRole("link", { name })).toHaveAttribute("href", href);
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
  });

  it("keeps query-known review context and an internal return destination", () => {
    const surface = renderTerminal("/review/session-1", "?sample=1&returnTo=%2Focr%2Fnew");

    expect(surface).toHaveTextContent("サンプルの読み取り結果で表示中");
    expect(within(surface).getByRole("link", { name: "入力をやめる" })).toHaveAttribute(
      "href",
      "/ocr/new",
    );
  });

  it("preserves sample and handoff context when returning from settings", () => {
    renderTerminal(
      "/admin/masters",
      "?returnTo=%2Freview%2Fsession-1%3Fsample%3D1&handoffId=handoff-1",
    );

    expect(screen.getByRole("link", { name: "元の画面へ戻る" })).toHaveAttribute(
      "href",
      "/review/session-1?sample=1&handoffId=handoff-1",
    );
  });

  it("does not offer an external return destination from settings", () => {
    renderTerminal("/admin/masters", "?returnTo=%2F%2Fexternal.test&handoffId=handoff-1");

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("時間をおいて再試行してください。")).toBeVisible();
  });

  it("keeps creation actions scoped to the current list query", () => {
    const surface = renderTerminal("/matches", "?status=confirmed");
    const actions = within(within(surface).getByRole("group", { name: "試合を登録" }));

    expect(actions.getByRole("link", { name: "OCR取り込み" })).toHaveAttribute(
      "href",
      "/ocr/new?returnTo=%2Fmatches%3Fstatus%3Dconfirmed",
    );
    expect(actions.getByRole("link", { name: "手入力で作成" })).toHaveAttribute(
      "href",
      "/matches/new?returnTo=%2Fmatches%3Fstatus%3Dconfirmed",
    );
  });
});
