import type { ReactNode } from "react";

import { Button } from "@/shared/ui/actions/Button";
import { cn } from "@/shared/ui/cn";
import { Notice } from "@/shared/ui/feedback/Notice";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";
import { ContentWithActions } from "@/shared/ui/layout/ContentWithActions";
import { readableTextWidthClass } from "@/shared/ui/layout/readableText";
import { contentText } from "@/shared/ui/typography";

/**
 * Keeps a tab's heading in place while its directory loads or fails; only the content below it
 * is replaced. Actions that need the directory appear once it is ready. Cached content owns its
 * refresh notice.
 */
export function MasterPanelContent({
  actions,
  children,
  description,
  heading,
  headingVisibility = "visible",
  resource,
  resourceLabel,
}: {
  actions?: ReactNode;
  children: ReactNode;
  description: ReactNode;
  heading: string;
  /** Use screen-reader when the selected tab label already names the panel visibly. */
  headingVisibility?: "screen-reader" | "visible";
  resource: {
    hasData: boolean;
    loadFailed: boolean;
    onRetry: () => Promise<boolean>;
    refreshing: boolean;
  };
  resourceLabel: string;
}) {
  return (
    <section className="grid min-w-0 gap-4">
      <ContentWithActions actions={resource.hasData ? actions : undefined}>
        <header className="grid gap-1">
          <h2 className={headingVisibility === "visible" ? contentText.heading : "sr-only"}>
            {heading}
          </h2>
          <p className={cn(contentText.body, readableTextWidthClass)}>{description}</p>
        </header>
      </ContentWithActions>
      {resource.hasData ? (
        children
      ) : resource.loadFailed ? (
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
      ) : (
        <div aria-label={`${resourceLabel}を読み込み中`} role="status">
          <Skeleton className="h-44" />
        </div>
      )}
    </section>
  );
}
