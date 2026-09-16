import type { ReactNode } from "react";

import { Button } from "@/shared/ui/actions/Button";
import { Notice } from "@/shared/ui/feedback/Notice";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";

/** Initial resource failure stays inside its tab; cached content owns its refresh notice. */
export function MasterPanelContent({
  children,
  resource,
  resourceLabel,
}: {
  children: ReactNode;
  resource: {
    hasData: boolean;
    loadFailed: boolean;
    onRetry: () => Promise<boolean>;
    refreshing: boolean;
  };
  resourceLabel: string;
}) {
  if (resource.hasData) return children;
  if (resource.loadFailed) {
    return (
      <Notice
        title={`${resourceLabel}を読み込めません`}
        tone="danger"
        action={
          <Button
            variant="secondary"
            size="sm"
            pending={resource.refreshing}
            pendingLabel="再読み込み中"
            onClick={async (event) => {
              const panel = event.currentTarget.closest<HTMLElement>('[role="tabpanel"]');
              if (await resource.onRetry()) panel?.focus();
            }}
          >
            再読み込み
          </Button>
        }
      >
        通信状態を確認して、もう一度読み込んでください。
      </Notice>
    );
  }
  return (
    <div aria-label={`${resourceLabel}を読み込み中`} className="grid gap-4" role="status">
      <Skeleton className="h-20" />
      <Skeleton className="h-44" />
    </div>
  );
}
