import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { MatchFormActions } from "@/features/matches/workspace/MatchFormActions";
import { createEmptyMatchForm } from "@/features/matches/workspace/matchFormTypes";
import { MatchSetupSection } from "@/features/matches/workspace/MatchSetupSection";
import { MatchWorkspaceBlockedNotice } from "@/features/matches/workspace/MatchWorkspaceBlockedNotice";
import { toMatchWorkspaceOperationErrorView } from "@/features/matches/workspace/matchWorkspaceOperationError";

describe("match workspace operation feedback", () => {
  it("keeps a held-event creation failure inside its disclosure with impact and recovery", async () => {
    const user = userEvent.setup();
    render(
      <MatchSetupSection
        actions={{ onGameTitleChange: vi.fn(), onPatchRoot: vi.fn() }}
        errorPathSet={new Set()}
        eventCreation={{
          draftValue: "2026-01-01T09:00",
          error: toMatchWorkspaceOperationErrorView({
            kind: "heldEventCreation",
            message: "開催履歴の作成に失敗しました。",
          }),
          pending: false,
          onCreate: vi.fn(),
          onDraftChange: vi.fn(),
        }}
        options={{ gameTitleItems: [], heldEvents: [], mapItems: [], seasonItems: [] }}
        values={createEmptyMatchForm("2026-01-01T09:00:00.000Z")}
        workspaceActions={{
          cancelDraft: {
            canCancel: false,
            confirmOpen: false,
            confirmPending: false,
            disabled: false,
            error: null,
            onConfirm: vi.fn(),
            onOpenChange: vi.fn(),
            onTrigger: vi.fn(),
          },
          mastersNavigation: { onClick: vi.fn(), pending: false, show: false },
        }}
      />,
    );

    await user.click(screen.getByText("一覧にない開催履歴を追加する"));
    const disclosure = screen.getByText("一覧にない開催履歴を追加する").closest("div");
    if (!disclosure) throw new Error("expected held-event creation disclosure");
    expect(within(disclosure).getByRole("alert")).toHaveTextContent(
      "開催履歴は追加されておらず、試合条件も変更していません",
    );
    expect(within(disclosure).getByRole("alert")).toHaveTextContent("もう一度作成してください");
  });

  it("keeps a save failure in the execution area while leaving retry available", () => {
    render(
      <MatchFormActions
        actionLabel="保存"
        disabled={false}
        error={toMatchWorkspaceOperationErrorView({
          kind: "update",
          message: "更新に失敗しました。",
        })}
        message="確定前の確認へ進めます"
        pending={false}
        primaryActionRef={null}
        onPrimaryAction={vi.fn()}
      />,
    );

    const executionArea = screen.getByRole("region", { name: "入力内容の確定" });
    expect(within(executionArea).getByRole("alert")).toHaveTextContent("入力内容は保持しています");
    expect(within(executionArea).getByRole("button", { name: "保存" })).toBeEnabled();
  });

  it("keeps a draft deletion failure beside the draft deletion action", () => {
    render(
      <MatchSetupSection
        actions={{ onGameTitleChange: vi.fn(), onPatchRoot: vi.fn() }}
        errorPathSet={new Set()}
        eventCreation={{
          draftValue: "",
          error: null,
          pending: false,
          onCreate: vi.fn(),
          onDraftChange: vi.fn(),
        }}
        options={{ gameTitleItems: [], heldEvents: [], mapItems: [], seasonItems: [] }}
        values={createEmptyMatchForm("2026-01-01T09:00:00.000Z")}
        workspaceActions={{
          cancelDraft: {
            canCancel: true,
            confirmOpen: false,
            confirmPending: false,
            disabled: false,
            error: toMatchWorkspaceOperationErrorView({
              kind: "cancelDraft",
              message: "削除に失敗しました。",
            }),
            onConfirm: vi.fn(),
            onOpenChange: vi.fn(),
            onTrigger: vi.fn(),
          },
          mastersNavigation: { onClick: vi.fn(), pending: false, show: false },
        }}
      />,
    );

    const deleteButton = screen.getByRole("button", { name: "確定前の記録を削除" });
    const actionGroup = deleteButton.closest("div")?.parentElement;
    if (!actionGroup) throw new Error("expected draft deletion action group");
    expect(within(actionGroup).getByRole("alert")).toHaveTextContent(
      "確定前の記録と入力内容は残っています",
    );
  });

  it("announces a draft status failure once beside its retry action", () => {
    render(
      <MemoryRouter>
        <MatchWorkspaceBlockedNotice
          error={toMatchWorkspaceOperationErrorView({
            kind: "draftStatus",
            message: "状態確認に失敗しました。",
          })}
          refreshingReviewStatus={false}
          onRefreshReviewStatus={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("alert")).toHaveTextContent("状態確認に失敗しました");
    expect(screen.getByRole("button", { name: "状態を再確認" })).toBeEnabled();
  });
});
