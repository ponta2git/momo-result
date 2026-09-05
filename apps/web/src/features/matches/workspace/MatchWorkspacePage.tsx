import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";

import { MatchConfirmDialog } from "@/features/matches/workspace/MatchConfirmDialog";
import type { WorkspaceMode } from "@/features/matches/workspace/matchFormTypes";
import { MatchWorkspaceBlockedNotice } from "@/features/matches/workspace/MatchWorkspaceBlockedNotice";
import { MatchWorkspaceEditor } from "@/features/matches/workspace/MatchWorkspaceEditor";
import { MatchWorkspaceLoading } from "@/features/matches/workspace/MatchWorkspaceLoading";
import { MatchWorkspaceNavigationGuard } from "@/features/matches/workspace/MatchWorkspaceNavigationGuard";
import { MatchWorkspaceToolbar } from "@/features/matches/workspace/MatchWorkspaceToolbar";
import { useMatchWorkspacePageModel } from "@/features/matches/workspace/useMatchWorkspacePageModel";
import { draftIdsFromParams } from "@/features/matches/workspace/workspaceDerivations";
import { useAuth } from "@/shared/auth/useAuth";
import { Button } from "@/shared/ui/actions/Button";
import { Notice } from "@/shared/ui/feedback/Notice";
import { PageContentSurface } from "@/shared/ui/layout/PageContentSurface";
import { PageFrame } from "@/shared/ui/layout/PageFrame";

type MatchWorkspacePageProps = {
  matchDraftId?: string;
  matchId?: string;
  matchSessionId?: string;
  mode: WorkspaceMode;
  preferredHeldEventId?: string;
};

/** Identifies local state that must not cross workspace or OCR-input boundaries. */
function matchWorkspaceIdentityKey(
  props: MatchWorkspacePageProps,
  searchParams: URLSearchParams,
  accountId: string | undefined,
): string {
  const useSampleDrafts = props.mode === "review" && searchParams.get("sample") === "1";
  const legacyDraftIds =
    props.mode === "review" && !useSampleDrafts ? draftIdsFromParams(searchParams) : {};
  return JSON.stringify({
    accountId: accountId ?? null,
    legacyDraftIds,
    matchDraftId: props.matchDraftId ?? null,
    matchId: props.matchId ?? null,
    matchSessionId: props.matchSessionId ?? null,
    mode: props.mode,
    useSampleDrafts,
  });
}

export function MatchWorkspacePage(props: MatchWorkspacePageProps) {
  const [searchParams] = useSearchParams();
  const { auth, isChecking } = useAuth();
  const useSampleDrafts = props.mode === "review" && searchParams.get("sample") === "1";
  if (isChecking) {
    return <MatchWorkspaceLoading sample={useSampleDrafts} />;
  }
  return (
    <MatchWorkspacePageContent
      key={matchWorkspaceIdentityKey(props, searchParams, auth?.accountId)}
      accountId={auth?.accountId}
      {...props}
    />
  );
}

function MatchWorkspacePageContent({
  accountId,
  matchDraftId,
  matchId,
  matchSessionId,
  mode,
  preferredHeldEventId,
}: MatchWorkspacePageProps & { accountId: string | undefined }) {
  const pageModel = useMatchWorkspacePageModel({
    accountId,
    matchDraftId,
    matchId,
    matchSessionId,
    mode,
    preferredHeldEventId,
  });
  const { editor, loading, navigation, persistence, review, validationFocusRequest } = pageModel;

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

  if (loading.edit.loading) {
    return (
      <MatchWorkspaceLoading
        loadingLabel="試合編集を読み込み中"
        sample={navigation.toolbar.sample}
      />
    );
  }

  if (loading.edit.failureKind) {
    const notFound = loading.edit.failureKind === "notFound";
    const title = notFound ? "試合が見つかりませんでした" : "試合編集を読み込めませんでした";
    return (
      <PageFrame width="workspace">
        <PageContentSurface aria-label="試合内容" className="grid grid-cols-1 gap-6" role="region">
          <MatchWorkspaceToolbar model={navigation.toolbar} />
          <Notice
            action={
              notFound ? undefined : (
                <Button
                  pending={loading.edit.retrying}
                  pendingLabel="再読み込み中"
                  size="sm"
                  onClick={loading.edit.onRetry}
                >
                  試合編集を再読み込み
                </Button>
              )
            }
            title={title}
            tone={notFound ? "warning" : "danger"}
          >
            <p>
              {notFound
                ? "指定された試合は削除されたか、存在しません。前の画面から別の試合を選んでください。"
                : "通信状態を確認して、もう一度お試しください。"}
            </p>
          </Notice>
        </PageContentSurface>
      </PageFrame>
    );
  }

  if (loading.workspace.loading) {
    return (
      <MatchWorkspaceLoading
        loadingLabel={loading.workspace.copy.loadingLabel}
        sample={navigation.toolbar.sample}
      />
    );
  }

  return (
    <PageFrame width="workspace">
      <PageContentSurface aria-label="試合内容" className="grid grid-cols-1 gap-6" role="region">
        <MatchWorkspaceToolbar model={navigation.toolbar} />
        {loading.base.errors.length > 0 ? (
          <Notice
            action={
              <Button
                pending={loading.base.retrying}
                pendingLabel="再読み込み中"
                size="sm"
                variant="secondary"
                onClick={() => void loading.base.onRetry()}
              >
                失敗したデータを再読み込み
              </Button>
            }
            tone="danger"
            title="画面データを読み込めません"
          >
            <ul className="grid list-disc gap-1 pl-5 text-sm">
              {loading.base.errors.map((error) => (
                <li className="momo-break-token" key={`${error.status}-${error.detail}`}>
                  <span className="font-semibold">{error.title}</span>：{error.detail}
                </li>
              ))}
            </ul>
          </Notice>
        ) : null}

        {loading.workspace.blocked ? null : review.blocked ? (
          <MatchWorkspaceBlockedNotice model={review.blocked} />
        ) : (
          <MatchWorkspaceEditor model={editor} />
        )}
      </PageContentSurface>

      {persistence.confirmation ? <MatchConfirmDialog model={persistence.confirmation} /> : null}
      <MatchWorkspaceNavigationGuard model={navigation.guard} />
    </PageFrame>
  );
}
