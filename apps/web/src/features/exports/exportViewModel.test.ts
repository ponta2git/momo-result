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
      selectedLabel: "選択中ID: match-missing",
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
        actionLabel: "マスタ管理へ",
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
    expect(view.disableReason).toBe("出力範囲の候補を選択してください。");
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
        detail: "Specify at most one export scope.",
        kind: "api",
        status: 422,
        title: "Validation Failed",
      }),
    ).toEqual({
      detail: "Specify at most one export scope.",
      kind: "failed",
      title: "Validation Failed",
    });
  });
});
