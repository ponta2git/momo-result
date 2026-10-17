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

import { preservesMastersInput } from "@/features/masters/masterNavigationModel";
import { UnsavedChangesGuard } from "@/shared/navigation/UnsavedChangesGuard";
import { Notice } from "@/shared/ui/feedback/Notice";

type PanelWork = {
  dirty: boolean;
  pending: boolean;
  error?: string | undefined;
  discard: () => void;
};
type ReportWork = (panel: string, work: PanelWork | undefined) => void;

const WorkReporter = createContext<ReportWork | undefined>(undefined);
const WorkFeedback = createContext({ pending: false, error: undefined as string | undefined });

/** Only navigation protection and page-level feedback cross independently subscribed panels. */
export function MastersWorkBoundary({ children }: { children: ReactNode }) {
  const [panels, setPanels] = useState<Record<string, PanelWork>>({});
  const report = useCallback<ReportWork>((panel, work) => {
    setPanels((current) => {
      const previous = current[panel];
      if (
        previous === work ||
        (previous &&
          work &&
          previous.pending === work.pending &&
          previous.dirty === work.dirty &&
          previous.error === work.error &&
          previous.discard === work.discard)
      )
        return current;
      const next = { ...current };
      if (work) next[panel] = work;
      else delete next[panel];
      return next;
    });
  }, []);
  const work = Object.values(panels);
  const pending = work.some((panel) => panel.pending);
  const dirty = work.some((panel) => panel.dirty);
  const error = work.find((panel) => panel.error)?.error;
  const feedback = useMemo(() => ({ pending, error }), [pending, error]);

  return (
    <WorkReporter value={report}>
      <UnsavedChangesGuard
        model={{
          dirty,
          isNavigationAllowed: () => false,
          onDiscard: () => work.forEach((panel) => panel.dirty && panel.discard()),
        }}
        pending={pending}
        preservesInput={preservesMastersInput}
        showPendingDialog={false}
        description="変更した通知設定はまだ保存されていません。このページに残れば、設定タブを切り替えても編集を続けられます。"
        pendingDescription="設定の追加・保存・削除の結果を確認しています。このページでお待ちください。"
      />
      <WorkFeedback value={feedback}>{children}</WorkFeedback>
    </WorkReporter>
  );
}

/** Keeps the panel's current discard capability local; text changes do not publish a new model. */
export function useReportMasterWork(
  panel: string,
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
  const report = useContext(WorkReporter);
  const discardRef = useRef(discard);
  useLayoutEffect(() => {
    discardRef.current = discard;
  }, [discard]);
  const discardCurrent = useCallback(() => discardRef.current?.(), []);
  useLayoutEffect(() => {
    report?.(panel, { pending, dirty, error, discard: discardCurrent });
  }, [panel, pending, dirty, error, discardCurrent, report]);
  useLayoutEffect(() => () => report?.(panel, undefined), [panel, report]);
}

export function MastersWorkFeedback() {
  const { pending, error } = useContext(WorkFeedback);
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
