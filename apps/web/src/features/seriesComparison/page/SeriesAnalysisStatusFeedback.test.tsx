import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SeriesAnalysisStatusFeedback } from "@/features/seriesComparison/page/SeriesAnalysisStatusFeedback";
import type { SeriesAnalysisStatusResponse } from "@/shared/api/seriesAnalysis";
import { makeSeriesAnalysisStatus } from "@/test/msw/seriesAnalysisFixtures";

type Calculation = NonNullable<SeriesAnalysisStatusResponse["calculation"]>;

function calculation(status: Calculation["status"]): Calculation {
  return {
    finishedAt: status === "queued" || status === "running" ? null : "2026-08-09T02:10:00.000Z",
    requestedAt: "2026-08-09T02:00:00.000Z",
    startedAt: status === "queued" ? null : "2026-08-09T02:00:01.000Z",
    status,
    trigger: "manual",
  };
}

function renderFeedback({
  confirmedMatchCount = 12,
  hasError = false,
  loading = false,
  status = makeSeriesAnalysisStatus(),
}: {
  confirmedMatchCount?: number;
  hasError?: boolean;
  loading?: boolean;
  status?: SeriesAnalysisStatusResponse | null | undefined;
} = {}) {
  const onRefresh = vi.fn();
  const view = render(
    <SeriesAnalysisStatusFeedback
      confirmedMatchCount={confirmedMatchCount}
      hasError={hasError}
      loading={loading}
      status={status ?? undefined}
      onRefresh={onRefresh}
    />,
  );
  return { ...view, onRefresh };
}

describe("SeriesAnalysisStatusFeedback", () => {
  it.each([
    {
      expectedTitle: "分析データの再計算を待っています",
      status: makeSeriesAnalysisStatus({ calculation: calculation("queued") }),
    },
    {
      expectedTitle: "分析データを再計算中です",
      status: makeSeriesAnalysisStatus({ calculation: calculation("running") }),
    },
    {
      expectedTitle: "新しい戦績データの計算を待っています",
      status: makeSeriesAnalysisStatus({
        artifactFreshness: "stale",
        calculation: calculation("queued"),
      }),
    },
    {
      expectedTitle: "新しい戦績データを計算中です",
      status: makeSeriesAnalysisStatus({
        artifactFreshness: "stale",
        calculation: calculation("running"),
      }),
    },
    {
      expectedTitle: "分析データを再計算できませんでした",
      status: makeSeriesAnalysisStatus({
        artifactFreshness: "stale",
        calculation: calculation("failed"),
      }),
    },
    {
      expectedTitle: "分析データの再計算が時間内に完了しませんでした",
      status: makeSeriesAnalysisStatus({
        artifactFreshness: "stale",
        calculation: calculation("timed_out"),
      }),
    },
    {
      expectedTitle: "新しい試合結果はまだ反映されていません",
      status: makeSeriesAnalysisStatus({ artifactFreshness: "stale", calculation: null }),
    },
  ])("keeps the last artifact visible for $expectedTitle", ({ expectedTitle, status }) => {
    renderFeedback({ status });

    const notice = screen.getByRole("status");
    expect(notice).toHaveTextContent(expectedTitle);
    expect(notice).toHaveTextContent("2026/08/09 10:02更新のデータ");
  });

  it.each([
    {
      confirmedMatchCount: 12,
      expectedTitle: "戦績データの計算を待っています",
      status: makeSeriesAnalysisStatus({
        artifactFreshness: "unavailable",
        calculation: calculation("queued"),
        currentArtifact: null,
      }),
    },
    {
      confirmedMatchCount: 12,
      expectedTitle: "戦績データを計算中です",
      status: makeSeriesAnalysisStatus({
        artifactFreshness: "unavailable",
        calculation: calculation("running"),
        currentArtifact: null,
      }),
    },
    {
      confirmedMatchCount: 12,
      expectedTitle: "戦績データを計算できませんでした",
      status: makeSeriesAnalysisStatus({
        artifactFreshness: "unavailable",
        calculation: calculation("failed"),
        currentArtifact: null,
      }),
    },
    {
      confirmedMatchCount: 12,
      expectedTitle: "戦績データの計算が時間内に完了しませんでした",
      status: makeSeriesAnalysisStatus({
        artifactFreshness: "unavailable",
        calculation: calculation("timed_out"),
        currentArtifact: null,
      }),
    },
    {
      confirmedMatchCount: 0,
      expectedTitle: "対戦データがありません",
      status: makeSeriesAnalysisStatus({
        artifactFreshness: "unavailable",
        calculation: null,
        currentArtifact: null,
      }),
    },
    {
      confirmedMatchCount: 12,
      expectedTitle: "表示できる分析データがありません",
      status: makeSeriesAnalysisStatus({
        artifactFreshness: "unavailable",
        calculation: null,
        currentArtifact: null,
      }),
    },
  ])(
    "uses the no-artifact oracle for $expectedTitle",
    ({ confirmedMatchCount, expectedTitle, status }) => {
      renderFeedback({ confirmedMatchCount, status });

      expect(screen.getByRole("heading", { name: expectedTitle })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "状態を再確認" })).toBeInTheDocument();
    },
  );

  it("distinguishes status-read failures with and without a cached artifact", async () => {
    const user = userEvent.setup();
    const cached = renderFeedback({ hasError: true });

    expect(screen.getByRole("status")).toHaveTextContent("計算状態を確認できません");
    await user.click(screen.getByRole("button", { name: "状態を再確認" }));
    expect(cached.onRefresh).toHaveBeenCalledOnce();

    cached.unmount();
    renderFeedback({ hasError: true, status: null });
    expect(screen.getByRole("heading", { name: "戦績データを取得できません" })).toBeInTheDocument();
  });

  it("renders no status feedback for a current successful artifact or initial loading", () => {
    const current = renderFeedback();
    expect(current.container).toBeEmptyDOMElement();

    current.unmount();
    const loading = renderFeedback({ loading: true, status: null });
    expect(loading.container).toBeEmptyDOMElement();
  });
});
