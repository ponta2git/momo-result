import { useSearchParams } from "react-router-dom";
import type { Location } from "react-router-dom";

import type { WorkspaceMode } from "@/features/matches/workspace/matchFormTypes";
import { MatchWorkspaceBlockedNotice } from "@/features/matches/workspace/MatchWorkspaceBlockedNotice";
import { MatchWorkspaceEditor } from "@/features/matches/workspace/MatchWorkspaceEditor";
import { MatchWorkspaceLoading } from "@/features/matches/workspace/MatchWorkspaceLoading";
import { MatchWorkspacePersistence } from "@/features/matches/workspace/MatchWorkspacePersistence";
import { MatchWorkspaceToolbar } from "@/features/matches/workspace/MatchWorkspaceToolbar";
import { useMatchWorkspace } from "@/features/matches/workspace/useMatchWorkspace";
import { useAuthorization } from "@/shared/auth/useAuthorization";
import { trimSearchParam } from "@/shared/lib/searchParams";
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
  return JSON.stringify({
    accountId: accountId ?? null,
    matchDraftId: props.matchDraftId ?? null,
    matchId: props.matchId ?? null,
    matchSessionId: props.matchSessionId ?? null,
    mode: props.mode,
    useSampleDrafts,
  });
}

function preservesWorkspaceInput(mode: WorkspaceMode, current: Location, next: Location): boolean {
  if (current.pathname !== next.pathname) return false;
  const currentParams = new URLSearchParams(current.search);
  const nextParams = new URLSearchParams(next.search);
  if (mode === "create") {
    return (
      trimSearchParam(currentParams.get("matchDraftId")) ===
      trimSearchParam(nextParams.get("matchDraftId"))
    );
  }
  if (mode === "review") {
    return (currentParams.get("sample") === "1") === (nextParams.get("sample") === "1");
  }
  return true;
}

export function MatchWorkspacePage(props: MatchWorkspacePageProps) {
  const [searchParams] = useSearchParams();
  const authorization = useAuthorization();
  const { auth, isChecking } = authorization.auth;
  const useSampleDrafts = props.mode === "review" && searchParams.get("sample") === "1";
  if (isChecking) {
    return <MatchWorkspaceLoading sample={useSampleDrafts} />;
  }
  return (
    <MatchWorkspacePageContent
      key={matchWorkspaceIdentityKey(props, searchParams, auth?.accountId)}
      accountId={auth?.accountId}
      canManageMasters={authorization.allowed.operations}
      canNavigateToMasters={() => authorization.can("operations")}
      {...props}
    />
  );
}

function MatchWorkspacePageContent({
  accountId,
  canManageMasters,
  canNavigateToMasters,
  matchDraftId,
  matchId,
  matchSessionId,
  mode,
  preferredHeldEventId,
}: MatchWorkspacePageProps & {
  accountId: string | undefined;
  canManageMasters: boolean;
  canNavigateToMasters: () => boolean;
}) {
  const workspace = useMatchWorkspace({
    accountId,
    canManageMasters,
    canNavigateToMasters,
    matchDraftId,
    matchId,
    matchSessionId,
    mode,
    preferredHeldEventId,
  });
  const { editor, editing, loading, toolbar, persistence, review } = workspace;

  if (loading.edit.loading) {
    return <MatchWorkspaceLoading loadingLabel="試合編集を読み込み中" sample={toolbar.sample} />;
  }

  if (loading.edit.failureKind) {
    const notFound = loading.edit.failureKind === "notFound";
    const title = notFound ? "試合が見つかりませんでした" : "試合編集を読み込めませんでした";
    return (
      <PageFrame width="workspace">
        <PageContentSurface aria-label="試合内容" className="grid grid-cols-1 gap-6" role="region">
          <MatchWorkspaceToolbar view={toolbar} />
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
      <MatchWorkspacePersistence
        input={persistence}
        preservesInput={(current, next) => preservesWorkspaceInput(mode, current, next)}
      >
        <MatchWorkspaceLoading
          loadingLabel={loading.workspace.copy.loadingLabel}
          sample={toolbar.sample}
        />
      </MatchWorkspacePersistence>
    );
  }

  return (
    <MatchWorkspacePersistence
      input={persistence}
      preservesInput={(current, next) => preservesWorkspaceInput(mode, current, next)}
    >
      <PageFrame width="workspace">
        <PageContentSurface aria-label="試合内容" className="grid grid-cols-1 gap-6" role="region">
          <MatchWorkspaceToolbar view={toolbar} />
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
                    <span className="font-emphasis">{error.title}</span>：{error.detail}
                  </li>
                ))}
              </ul>
            </Notice>
          ) : null}

          {loading.workspace.blocked ? null : review.blocked ? (
            <MatchWorkspaceBlockedNotice view={review.blocked} />
          ) : (
            <MatchWorkspaceEditor editing={editing} view={editor} />
          )}
        </PageContentSurface>
      </PageFrame>
    </MatchWorkspacePersistence>
  );
}
