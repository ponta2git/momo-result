import { useCallback, useEffect, useRef } from "react";

import { MatchConfirmDialog } from "@/features/matches/workspace/MatchConfirmDialog";
import type { WorkspaceMode } from "@/features/matches/workspace/matchFormTypes";
import { MatchWorkspaceBlockedNotice } from "@/features/matches/workspace/MatchWorkspaceBlockedNotice";
import { MatchWorkspaceEditor } from "@/features/matches/workspace/MatchWorkspaceEditor";
import { MatchWorkspaceHeader } from "@/features/matches/workspace/MatchWorkspaceHeader";
import { MatchWorkspaceLoading } from "@/features/matches/workspace/MatchWorkspaceLoading";
import { MatchWorkspaceNavigationGuard } from "@/features/matches/workspace/MatchWorkspaceNavigationGuard";
import { useMatchWorkspaceController } from "@/features/matches/workspace/useMatchWorkspaceController";
import { LinkButton } from "@/shared/ui/actions/LinkButton";
import { LiveRegion } from "@/shared/ui/feedback/LiveRegion";
import { Notice } from "@/shared/ui/feedback/Notice";
import { PageFrame } from "@/shared/ui/layout/PageFrame";

type MatchWorkspacePageProps = {
  matchDraftId?: string;
  matchId?: string;
  matchSessionId?: string;
  mode: WorkspaceMode;
  preferredHeldEventId?: string;
};

export function MatchWorkspacePage({
  matchDraftId,
  matchId,
  matchSessionId,
  mode,
  preferredHeldEventId,
}: MatchWorkspacePageProps) {
  const controller = useMatchWorkspaceController({
    matchDraftId,
    matchId,
    matchSessionId,
    mode,
    preferredHeldEventId,
  });
  const primaryActionRef = useRef<HTMLButtonElement>(null);
  const onRequestSubmitFocus = useCallback(() => {
    primaryActionRef.current?.focus();
  }, []);
  const {
    baseErrors,
    blockedNotice,
    confirmDialog,
    editor,
    formActions,
    header,
    liveMessage,
    loadState,
    navigationGuard,
    setup,
    validationFocusRequest,
  } = controller;

  useEffect(() => {
    if (!validationFocusRequest) {
      return;
    }
    const target = document.querySelector<HTMLElement>(
      `[data-validation-path="${validationFocusRequest.path}"]`,
    );
    target?.scrollIntoView?.({ block: "center" });
    target?.focus();
  }, [validationFocusRequest]);

  if (loadState.editLoading) {
    return (
      <MatchWorkspaceLoading
        description="保存済みの試合内容を取得しています。"
        title="試合編集を読み込み中"
      />
    );
  }

  if (loadState.workspaceLoading) {
    return (
      <MatchWorkspaceLoading
        description={loadState.workspaceLoadingCopy.description}
        title={loadState.workspaceLoadingCopy.title}
      />
    );
  }

  if (loadState.editLoadFailed) {
    return (
      <PageFrame>
        <Notice tone="danger" title="試合が見つかりませんでした">
          一覧に戻って、対象の試合を選び直してください。
        </Notice>
        <LinkButton to={header.cancelHref} variant="secondary">
          前の画面へ戻る
        </LinkButton>
      </PageFrame>
    );
  }

  return (
    <PageFrame width="workspace">
      <LiveRegion message={liveMessage} />

      <MatchWorkspaceHeader header={header} />

      {baseErrors.map((error) => (
        <Notice key={`${error.status}-${error.detail}`} tone="danger" title={error.title}>
          {error.detail}
        </Notice>
      ))}

      {blockedNotice ? (
        <MatchWorkspaceBlockedNotice {...blockedNotice} />
      ) : (
        <MatchWorkspaceEditor
          editor={editor}
          formActions={formActions}
          primaryActionRef={primaryActionRef}
          setup={setup}
          onRequestSubmitFocus={onRequestSubmitFocus}
        />
      )}

      {confirmDialog ? <MatchConfirmDialog {...confirmDialog} /> : null}
      <MatchWorkspaceNavigationGuard {...navigationGuard} />
    </PageFrame>
  );
}
