import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RouteTerminalPage } from "@/app/RouteTerminalPage";

describe("RouteTerminalPage", () => {
  it("keeps the sample context visible with the supplied failure explanation", () => {
    render(
      <RouteTerminalPage pathname="/review/session-1" search="?sample=1" title="表示できません">
        <p>時間をおいて再試行してください。</p>
      </RouteTerminalPage>,
    );

    const surface = screen.getByRole("region", { name: "表示できません" });
    expect(surface).toHaveTextContent("サンプルの読み取り結果で表示中");
    expect(surface).toHaveTextContent("時間をおいて再試行してください。");
  });
});
