import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SeriesAnalysisScopeBar } from "@/features/seriesComparison/page/SeriesAnalysisScopeBar";
import { makeSeriesAnalysisReview } from "@/test/msw/seriesAnalysisFixtures";

const baseProps = {
  canRefresh: true,
  mapOptions: [{ label: "東日本編", value: "map-east" }],
  mapValue: "map-east",
  onMapChange: vi.fn(),
  onRefresh: vi.fn(),
  onSeasonChange: vi.fn(),
  onSeriesChange: vi.fn(),
  refreshing: false,
  seasonOptions: [{ label: "今シーズン", value: "season-current" }],
  seasonValue: "season-current",
  seriesOptions: [{ label: "桃太郎電鉄2", value: "gt_momotetsu_2" }],
  seriesValue: "gt_momotetsu_2",
};

describe("SeriesAnalysisScopeBar", () => {
  it("keeps scope, count, freshness, controls, and update in one labeled surface", async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();
    render(
      <SeriesAnalysisScopeBar
        {...baseProps}
        onRefresh={onRefresh}
        response={makeSeriesAnalysisReview()}
      />,
    );

    const surface = screen.getByRole("region", { name: "比較条件" });
    expect(surface).toHaveTextContent("シーズン 今シーズン・マップ 東日本編");
    expect(surface).toHaveTextContent("12戦");
    expect(surface).toHaveTextContent("最終更新");
    expect(surface).not.toHaveTextContent(/十分|読み取り目安/u);
    expect(within(surface).getByRole("button", { name: /比較対象を変更/u })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(within(surface).getByRole("combobox", { name: "対象作品" })).toBeInTheDocument();
    expect(within(surface).queryByRole("combobox", { name: "シーズン" })).not.toBeInTheDocument();

    await user.click(within(surface).getByRole("button", { name: "表示を更新" }));
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it("reports only quality states that need attention", () => {
    const response = makeSeriesAnalysisReview();
    response.dataQuality.summary = { noTargetCount: 2, okCount: 5, referenceCount: 1 };

    render(<SeriesAnalysisScopeBar {...baseProps} response={response} />);

    const surface = screen.getByRole("region", { name: "比較条件" });
    expect(surface).toHaveTextContent("参考値 1項目・対象なし 2項目");
  });

  it("keeps collapsed details out of accessibility and tab order, then allows changes", async () => {
    const user = userEvent.setup();
    const onSeasonChange = vi.fn();
    render(
      <SeriesAnalysisScopeBar
        {...baseProps}
        onSeasonChange={onSeasonChange}
        response={makeSeriesAnalysisReview()}
        seasonOptions={[
          ...baseProps.seasonOptions,
          { label: "前シーズン", value: "season-previous" },
        ]}
      />,
    );

    const surface = screen.getByRole("region", { name: "比較条件" });
    const trigger = within(surface).getByRole("button", { name: /比較対象を変更/u });
    const mountedSeasonControl = within(surface).getByLabelText("シーズン");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveTextContent("シーズン 今シーズン・マップ 東日本編");
    expect(trigger).toHaveTextContent("12戦");
    expect(within(surface).queryByRole("combobox", { name: "シーズン" })).not.toBeInTheDocument();
    expect(within(surface).queryByRole("combobox", { name: "マップ" })).not.toBeInTheDocument();
    expect(mountedSeasonControl.closest("[hidden]")).not.toBeNull();

    trigger.focus();
    await user.tab();
    expect(mountedSeasonControl).not.toHaveFocus();

    await user.click(trigger);
    const seasonControl = within(surface).getByRole("combobox", { name: "シーズン" });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger).toHaveTextContent("シーズン 今シーズン・マップ 東日本編");
    expect(trigger).toHaveTextContent("12戦");
    expect(seasonControl.closest("[hidden]")).toBeNull();
    await user.selectOptions(seasonControl, "season-previous");
    expect(onSeasonChange).toHaveBeenCalledWith("season-previous");
  });

  it("omits a detail-filter summary when season and map use their defaults", () => {
    render(
      <SeriesAnalysisScopeBar
        {...baseProps}
        mapValue=""
        response={makeSeriesAnalysisReview()}
        seasonValue=""
      />,
    );

    const trigger = screen.getByRole("button", { name: /比較対象を変更/u });
    expect(trigger).not.toHaveTextContent("シーズン ");
    expect(trigger).not.toHaveTextContent("マップ ");
    expect(trigger).toHaveTextContent("12戦");
  });

  it("marks only an in-place update as pending", () => {
    render(
      <SeriesAnalysisScopeBar {...baseProps} refreshing response={makeSeriesAnalysisReview()} />,
    );

    const surface = screen.getByRole("region", { name: "比較条件" });
    expect(surface).toHaveAttribute("aria-busy", "true");
    expect(within(surface).getByRole("button", { name: "表示を更新中" })).toBeDisabled();
    expect(within(surface).queryByRole("button", { name: /再読み込み/u })).not.toBeInTheDocument();
  });
});
