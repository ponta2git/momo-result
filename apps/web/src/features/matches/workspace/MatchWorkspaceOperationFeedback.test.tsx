import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { MatchFormActions } from "@/features/matches/workspace/MatchFormActions";
import { createEmptyMatchForm } from "@/features/matches/workspace/matchFormTypes";
import { MatchSetupSection } from "@/features/matches/workspace/MatchSetupSection";
import { MatchWorkspaceBlockedNotice } from "@/features/matches/workspace/MatchWorkspaceBlockedNotice";
import { toMatchWorkspaceOperationErrorView } from "@/features/matches/workspace/matchWorkspaceOperationError";
import type { MatchWorkspaceOperationErrorView } from "@/features/matches/workspace/matchWorkspaceOperationError";

function setupSectionProps({
  cancellationAllowed = false,
  cancellationError = null,
  eventError = null,
}: {
  cancellationAllowed?: boolean;
  cancellationError?: MatchWorkspaceOperationErrorView | null;
  eventError?: MatchWorkspaceOperationErrorView | null;
} = {}) {
  return {
    cancellation: {
      allowed: cancellationAllowed,
      dialog: {
        open: false,
        pending: false,
        onConfirm: vi.fn(),
        onOpenChange: vi.fn(),
      },
      disabled: false,
      error: cancellationError,
      onTrigger: vi.fn(),
    },
    mastersNavigation: { pending: false, show: false, onNavigate: vi.fn() },
    model: {
      eventCreation: {
        action: { pending: false, onCreate: vi.fn() },
        feedback: { error: eventError },
        input: { value: "2026-01-01T09:00", onChange: vi.fn() },
      },
      fields: {
        actions: { onGameTitleChange: vi.fn(), onPatchRoot: vi.fn() },
        options: {
          gameTitleItems: [],
          heldEventPicker: {
            error: undefined,
            heldEvents: [],
            pagination: undefined,
            pending: false,
            refetch: vi.fn(async () => undefined),
            scopeChanging: false,
            selectedHeldEvent: undefined,
            onPageChange: vi.fn(),
          },
          heldEvents: [],
          mapItems: [],
          seasonItems: [],
        },
        validation: { errorPathSet: new Set<string>() },
        values: createEmptyMatchForm("2026-01-01T09:00:00.000Z"),
      },
    },
  };
}

describe("match workspace operation feedback", () => {
  it("keeps a held-event creation failure inside its disclosure with impact and recovery", async () => {
    const user = userEvent.setup();
    render(
      <MatchSetupSection
        {...setupSectionProps({
          eventError: toMatchWorkspaceOperationErrorView({
            kind: "heldEventCreation",
            message: "開催の作成に失敗しました。",
          }),
        })}
      />,
    );

    await user.click(screen.getByText("一覧にない開催を追加する"));
    const disclosure = screen.getByText("一覧にない開催を追加する").closest("div");
    if (!disclosure) throw new Error("expected held-event creation disclosure");
    expect(within(disclosure).getByRole("alert")).toHaveTextContent(
      "開催は追加されておらず、試合条件も変更していません",
    );
    expect(within(disclosure).getByRole("alert")).toHaveTextContent("もう一度作成してください");
  });

  it("keeps a save failure in the execution area while leaving retry available", () => {
    render(
      <MatchFormActions
        model={{
          action: { label: "保存", onRun: vi.fn() },
          availability: { disabled: false, pending: false },
          feedback: {
            error: toMatchWorkspaceOperationErrorView({
              kind: "update",
              message: "更新に失敗しました。",
            }),
            message: "確定前の確認へ進めます",
          },
        }}
        primaryActionRef={null}
      />,
    );

    const executionArea = screen.getByRole("region", { name: "入力内容の確定" });
    expect(within(executionArea).getByRole("alert")).toHaveTextContent("入力内容は保持しています");
    expect(within(executionArea).getByRole("button", { name: "保存" })).toBeEnabled();
  });

  it("keeps a draft deletion failure beside the draft deletion action", () => {
    render(
      <MatchSetupSection
        {...setupSectionProps({
          cancellationAllowed: true,
          cancellationError: toMatchWorkspaceOperationErrorView({
            kind: "cancelDraft",
            message: "削除に失敗しました。",
          }),
        })}
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
          model={{
            feedback: {
              error: toMatchWorkspaceOperationErrorView({
                kind: "draftStatus",
                message: "状態確認に失敗しました。",
              }),
            },
            refresh: { pending: false, onRefresh: vi.fn(async () => undefined) },
          }}
        />
      </MemoryRouter>,
    );

    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("alert")).toHaveTextContent("状態確認に失敗しました");
    expect(screen.getByRole("button", { name: "状態を再確認" })).toBeEnabled();
  });
});
