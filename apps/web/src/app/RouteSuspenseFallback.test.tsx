import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RouteSuspenseFallback } from "@/app/RouteSuspenseFallback";

describe("RouteSuspenseFallback", () => {
  it("provides a usable root landmark while announcing initial preparation", () => {
    render(<RouteSuspenseFallback asMain pathname="/" />);

    const main = screen.getByRole("main");
    const status = screen.getByRole("status");
    expect(main).toHaveAttribute("id", "main-content");
    expect(main).toContainElement(status);
    expect(status).toHaveTextContent("読み込んでいます");
    expect(status.closest('[aria-busy="true"]')).toBeNull();
    main.focus();
    expect(main).toHaveFocus();
  });

  it.each([
    ["/analytics/series", "戦績比較を読み込んでいます"],
    ["/admin/analysis", "戦績分析管理を読み込んでいます"],
    ["/admin/masters", "設定管理を読み込んでいます"],
  ])(
    "identifies the destination while loading %s without duplicating the main landmark",
    (pathname, label) => {
      render(<RouteSuspenseFallback pathname={pathname} />);

      expect(screen.getByRole("status")).toHaveTextContent(label);
      expect(screen.queryByRole("main")).not.toBeInTheDocument();
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
    },
  );

  it("keeps sample context visible while review controls are not ready", () => {
    render(<RouteSuspenseFallback pathname="/review/session-1" search="?sample=1" />);

    expect(screen.getByText("サンプルの読み取り結果で表示中")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("読み込んでいます");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
