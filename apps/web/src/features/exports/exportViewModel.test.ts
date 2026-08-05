// @vitest-environment node
import { describe, expect, it } from "vitest";

import { buildCandidateView, buildExportViewModel, failedResultView } from "./exportViewModel";

describe("exportViewModel", () => {
  it("keeps an unknown deep-linked candidate selectable", () => {
    const candidate = buildCandidateView({
      candidates: [{ label: "2026-01-01 / #1", value: "match-1" }],
      loading: false,
      scope: "match",
      selectedId: "match-missing",
    });

    expect(candidate).toMatchObject({
      kind: "ready",
      selectedId: "match-missing",
      selectedLabel: "指定された対象: match-missing",
      selectedUnknown: true,
    });
  });

  it("keeps a deep-linked candidate even when the candidate list is empty", () => {
    const candidate = buildCandidateView({
      candidates: [],
      loading: false,
      scope: "match",
      selectedId: "match-from-url",
    });

    expect(candidate).toMatchObject({
      kind: "ready",
      selectedId: "match-from-url",
      selectedUnknown: true,
    });
  });

  it("disables download when a scoped candidate is missing", () => {
    const view = buildExportViewModel({
      candidate: {
        kind: "empty",
        actionHref: "/masters",
        actionLabel: "設定管理へ",
        message: "",
        title: "",
      },
      elapsedMs: 0,
      isPending: false,
      slowThresholdMs: 10_000,
      urlState: {
        errors: [],
        format: "csv",
        scope: "season",
      },
    });

    expect(view.canDownload).toBe(false);
    expect(view.actionLabel).toBe("このシーズンをCSVでダウンロード");
    expect(view.summaryText).toBe("シーズンの出力対象を選択してください。");
  });

  it("disables download while scoped candidates are refreshing", () => {
    const view = buildExportViewModel({
      candidate: {
        candidates: [{ label: "2026-01-01 / #1", value: "match-1" }],
        kind: "ready",
        selectedId: "match-1",
        selectedLabel: "2026-01-01 / #1",
        selectedUnknown: false,
      },
      candidateRefreshing: true,
      elapsedMs: 0,
      isPending: false,
      slowThresholdMs: 10_000,
      urlState: {
        errors: [],
        format: "csv",
        matchId: "match-1",
        scope: "match",
      },
    });

    expect(view.canDownload).toBe(false);
    expect(view.candidateRefreshing).toBe(true);
    expect(view.actionLabel).toBe("この試合をCSVでダウンロード");
    expect(view.summaryText).toBe("2026-01-01 / #1をCSVで書き出します。");
  });

  it("includes candidate metadata in the selected label", () => {
    const candidate = buildCandidateView({
      candidates: [
        {
          description: "3年決戦",
          label: "2026-01-01 09:00 / 第1試合",
          value: "match-1",
        },
      ],
      loading: false,
      scope: "match",
      selectedId: "match-1",
    });

    expect(candidate).toMatchObject({
      kind: "ready",
      selectedLabel: "2026-01-01 09:00 / 第1試合 — 3年決戦",
    });
  });

  it("shows slow state while a download is pending past threshold", () => {
    const view = buildExportViewModel({
      candidate: { kind: "hidden" },
      elapsedMs: 10_000,
      isPending: true,
      slowThresholdMs: 10_000,
      urlState: { errors: [], format: "csv", scope: "all" },
    });

    expect(view.isSlow).toBe(true);
    expect(view.canDownload).toBe(false);
  });

  it("maps API errors to user-facing failed results", () => {
    expect(
      failedResultView({
        code: "VALIDATION_FAILED",
        detail: "Specify at most one export scope.",
        kind: "api",
        status: 422,
        title: "Validation Failed",
      }),
    ).toEqual({
      detail: "出力条件に問題があります。条件を確認して、もう一度お試しください。",
      kind: "failed",
      title: "出力条件を確認してください",
    });
  });
});
