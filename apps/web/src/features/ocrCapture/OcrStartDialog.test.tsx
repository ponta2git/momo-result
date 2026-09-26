import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { createInitialSlot } from "@/features/ocrCapture/captureState";
import { OcrStartDialog } from "@/features/ocrCapture/OcrStartDialog";
import type { OcrSubmissionPlan } from "@/features/ocrCapture/ocrSubmissionPlan";
import type { OcrSubmissionResult } from "@/features/ocrCapture/ocrSubmissionWorkflow";
import type { OcrCaptureMutations } from "@/features/ocrCapture/useOcrCaptureMutations";
import { useOcrStartFlow } from "@/features/ocrCapture/useOcrStartFlow";
import { createDeferred } from "@/test/deferred";

const plan: OcrSubmissionPlan = {
  hints: {},
  playedAt: "2026-01-01T00:00:00Z",
  selectedGameTitle: undefined,
  selectedHeldEvent: undefined,
  selectedSlotLabels: ["総資産", "収益", "事件簿"],
  setup: {
    gameTitleId: "game-1",
    mapMasterId: "map-1",
    ownerMemberId: "member-1",
    seasonMasterId: "season-1",
  },
  setupSummary: {
    gameTitle: "桃太郎電鉄",
    heldEvent: "未選択",
    map: "日本",
    matchNo: "未設定",
    owner: "オーナー",
    season: "通常",
  },
  slots: [
    createInitialSlot("total_assets"),
    createInitialSlot("revenue"),
    createInitialSlot("incident_log"),
  ],
};

function FlowHarness({ submit }: { submit: OcrCaptureMutations["submit"] }) {
  const flow = useOcrStartFlow({
    submission: { isSubmitting: false, submit },
    updateSlot: vi.fn(),
  });
  return (
    <>
      <button type="button" onClick={() => flow.open(plan)}>
        読み取りの確認
      </button>
      <OcrStartDialog
        state={flow.state}
        onClose={flow.close}
        onConfirm={flow.confirm}
        onViewMatches={flow.viewMatches}
      />
    </>
  );
}

async function submitResult(...results: Array<OcrSubmissionResult | Promise<OcrSubmissionResult>>) {
  const submit = vi.fn<OcrCaptureMutations["submit"]>();
  for (const result of results) submit.mockImplementationOnce(async () => result);
  const router = createMemoryRouter([{ path: "/", element: <FlowHarness submit={submit} /> }]);
  render(<RouterProvider router={router} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "読み取りの確認" }));
  await user.click(screen.getByRole("button", { name: "3件で読み取りを開始" }));
  return { submit, user };
}

describe("OcrStartDialog", () => {
  it("does not offer a restart for an aborted submission", async () => {
    await submitResult({ status: "submission_closed", canRestart: false });
    expect(
      await screen.findByRole("dialog", { name: "この送信の受付は終了しました" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "試合一覧で確認" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "未受付の画像を新しく送信" }),
    ).not.toBeInTheDocument();
  });

  it.each<OcrSubmissionResult>([
    { status: "empty" },
    { status: "invalid", message: "設定を確認してください" },
    { status: "draft_create_failed", error: { kind: "api", status: 400 } },
    { status: "draft_create_failed", error: { kind: "api", status: 404 } },
  ])("returns to the retained inputs after a definite rejection: $status", async (result) => {
    const { user } = await submitResult(result);
    await user.click(await screen.findByRole("button", { name: "戻って確認" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "読み取りの確認" })).toBeInTheDocument();
  });

  it.each<OcrSubmissionResult>([
    { status: "draft_create_failed", error: new Error("connection lost") },
    { status: "draft_create_failed", error: { kind: "api", status: 408 } },
    { status: "draft_create_failed", error: { kind: "api", status: 409 } },
    { status: "draft_create_failed", error: { kind: "api", status: 429 } },
    { status: "submission_failed", matchDraftId: "draft-1" },
  ])("retries the same plan while acceptance may be uncertain: $status", async (result) => {
    const { submit, user } = await submitResult(result, {
      status: "partial_started",
      createdJobCount: 1,
      failedJobCount: 2,
    });
    await screen.findByRole("button", { name: "もう一度試す" });
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "戻って確認" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "もう一度試す" }));
    expect(
      await screen.findByRole("dialog", { name: "一部の読み取りを開始しました" }),
    ).toBeVisible();
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[1]?.[0].plan).toBe(submit.mock.calls[0]?.[0].plan);
    expect(submit.mock.calls[1]?.[0].restart).toBe(false);
  });

  it("does not release an uncertain plan when a later retry is rejected", async () => {
    const retry = createDeferred<OcrSubmissionResult>();
    const { submit, user } = await submitResult(
      { status: "draft_create_failed", error: new Error("connection lost") },
      retry.promise,
    );
    await user.click(await screen.findByRole("button", { name: "もう一度試す" }));
    expect(screen.getByRole("dialog", { name: "画像を送信しています" })).toBeVisible();
    await act(async () => {
      retry.resolve({ status: "draft_create_failed", error: { kind: "api", status: 404 } });
    });
    expect(
      await screen.findByRole("dialog", { name: "読み取りの受付を確認できませんでした" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "もう一度試す" })).toBeEnabled();
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[0]?.[0].plan).toBe(submit.mock.calls[1]?.[0].plan);
    await user.keyboard("{Escape}");
    expect(
      screen.getByRole("dialog", { name: "読み取りの受付を確認できませんでした" }),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "戻って確認" })).not.toBeInTheDocument();
  });
});
