// @vitest-environment node
import { describe, expect, it } from "vitest";

import { toMatchCandidates } from "./exportCandidateData";
import { buildCandidateView, buildExportViewModel, failedResultView } from "./exportViewModel";

describe("exportViewModel", () => {
  it("marks an unresolved deep-linked candidate as missing without using its ID as a label", () => {
    const candidate = buildCandidateView({
      candidates: [{ label: "2026-01-01 / #1", value: "match-1" }],
      loading: false,
      scope: "match",
      selectedId: "match-missing",
    });

    expect(candidate).toMatchObject({
      kind: "ready",
      selectedId: "match-missing",
      selectedLabel: "出力対象が未確定です",
      selectionState: "not-found",
    });
  });

  it("keeps a missing deep link non-downloadable even when the candidate list is empty", () => {
    const candidate = buildCandidateView({
      candidates: [],
      loading: false,
      scope: "match",
      selectedId: "match-from-url",
    });

    expect(candidate).toMatchObject({
      kind: "ready",
      selectedId: "match-from-url",
      selectedLabel: "出力対象が未確定です",
      selectionState: "not-found",
    });
  });

  it.each([
    ["heldEvent", "/held-events", "開催履歴へ"],
    ["match", "/matches", "試合一覧へ"],
  ] as const)("routes an empty %s scope to its owning list", (scope, href, label) => {
    expect(
      buildCandidateView({ candidates: [], loading: false, scope, selectedId: "" }),
    ).toMatchObject({
      action: { href, kind: "link", label },
      kind: "empty",
    });
  });

  it("disables download when a scoped candidate is missing", () => {
    const view = buildExportViewModel({
      candidate: {
        action: { kind: "scope", label: "全試合へ切り替え", scope: "all" },
        kind: "empty",
        message: "",
        title: "",
      },
      isPending: false,
      isSlow: false,
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

  it("keeps download enabled for a resolved candidate while its directory is refreshing", () => {
    const view = buildExportViewModel({
      candidate: {
        candidates: [{ label: "2026-01-01 / #1", value: "match-1" }],
        kind: "ready",
        selectedId: "match-1",
        selectedLabel: "2026-01-01 / #1",
        selectionState: "resolved",
      },
      candidateRefreshing: true,
      isPending: false,
      isSlow: false,
      urlState: {
        errors: [],
        format: "csv",
        matchId: "match-1",
        scope: "match",
      },
    });

    expect(view.canDownload).toBe(true);
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

  it("distinguishes unset master references from unresolved master names without exposing IDs", () => {
    const baseMatch = {
      createdAt: "2026-04-04T13:00:00.000Z",
      heldEventId: "held-1",
      id: "match-1",
      kind: "match",
      matchId: "match-1",
      matchNoInEvent: 1,
      playedAt: "2026-04-04T12:34:56.000Z",
      status: "confirmed",
      updatedAt: "2026-04-04T13:00:00.000Z",
    } as const;

    const unset = toMatchCandidates([baseMatch], [], [])[0];
    const gameTitleId = "opaque-game-title-id";
    const seasonMasterId = "opaque-season-id";
    const unresolved = toMatchCandidates(
      [{ ...baseMatch, gameTitleId, seasonMasterId }],
      [],
      [],
    )[0];

    expect(unset?.description).toBe("作品未設定・シーズン未設定");
    expect(unresolved?.description).toBe("作品名未取得・シーズン名未取得");
    expect(unresolved?.description).not.toContain(gameTitleId);
    expect(unresolved?.description).not.toContain(seasonMasterId);
  });

  it("shows slow state while a download is pending past threshold", () => {
    const view = buildExportViewModel({
      candidate: { kind: "hidden" },
      isPending: true,
      isSlow: true,
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
