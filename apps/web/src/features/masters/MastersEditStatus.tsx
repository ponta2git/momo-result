import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";

import { preservesMastersInput } from "@/features/masters/mastersNavigation";
import { UnsavedChangesGuard } from "@/shared/navigation/UnsavedChangesGuard";
import { Notice } from "@/shared/ui/feedback/Notice";

type PanelEditStatus = {
  dirty: boolean;
  pending: boolean;
  error?: string | undefined;
  discard: () => void;
};
type ReportEditStatus = (panelId: string, status: PanelEditStatus | undefined) => void;

const EditStatusReporter = createContext<ReportEditStatus | undefined>(undefined);
const EditFeedback = createContext({ pending: false, error: undefined as string | undefined });

/** Only navigation protection and page-level feedback cross independently subscribed panels. */
export function MastersEditStatusProvider({ children }: { children: ReactNode }) {
  const [panelStatuses, setPanelStatuses] = useState<Record<string, PanelEditStatus>>({});
  const reportStatus = useCallback<ReportEditStatus>((panelId, status) => {
    setPanelStatuses((current) => {
      const previous = current[panelId];
      if (
        previous === status ||
        (previous &&
          status &&
          previous.pending === status.pending &&
          previous.dirty === status.dirty &&
          previous.error === status.error &&
          previous.discard === status.discard)
      )
        return current;
      const next = { ...current };
      if (status) next[panelId] = status;
      else delete next[panelId];
      return next;
    });
  }, []);
  const statuses = Object.values(panelStatuses);
  const pending = statuses.some((status) => status.pending);
  const dirty = statuses.some((status) => status.dirty);
  const error = statuses.find((status) => status.error)?.error;
  const feedback = useMemo(() => ({ pending, error }), [pending, error]);

  return (
    <EditStatusReporter value={reportStatus}>
      <UnsavedChangesGuard
        model={{
          dirty,
          isNavigationAllowed: () => false,
          onDiscard: () => statuses.forEach((status) => status.dirty && status.discard()),
        }}
        pending={pending}
        preservesInput={preservesMastersInput}
        showPendingDialog={false}
        description="変更した通知設定はまだ保存されていません。このページに残れば、設定タブを切り替えても編集を続けられます。"
        pendingDescription="設定の追加・保存・削除の結果を確認しています。このページでお待ちください。"
      />
      <EditFeedback value={feedback}>{children}</EditFeedback>
    </EditStatusReporter>
  );
}

/** Keeps the panel's current discard capability local; text changes do not publish new status. */
export function useReportMasterEditStatus(
  panelId: string,
  {
    pending,
    dirty = false,
    error,
    discard,
  }: {
    pending: boolean;
    dirty?: boolean;
    error?: string | undefined;
    discard?: (() => void) | undefined;
  },
) {
  const reportStatus = useContext(EditStatusReporter);
  const discardRef = useRef(discard);
  useLayoutEffect(() => {
    discardRef.current = discard;
  }, [discard]);
  const discardCurrent = useCallback(() => discardRef.current?.(), []);
  useLayoutEffect(() => {
    reportStatus?.(panelId, { pending, dirty, error, discard: discardCurrent });
  }, [panelId, pending, dirty, error, discardCurrent, reportStatus]);
  useLayoutEffect(() => () => reportStatus?.(panelId, undefined), [panelId, reportStatus]);
}

export function MastersEditFeedback() {
  const { pending, error } = useContext(EditFeedback);
  return (
    <>
      <p className="text-sm text-[var(--color-text-secondary)] empty:hidden" role="status">
        {pending
          ? "設定の追加・保存・削除の結果を確認しています。完了するまで別の画面への移動をお待ちください。"
          : null}
      </p>
      {error ? (
        <Notice tone="danger" title="設定の変更に失敗しました">
          {error}
        </Notice>
      ) : null}
    </>
  );
}
