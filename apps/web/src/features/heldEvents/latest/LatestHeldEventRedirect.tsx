import { Navigate } from "react-router-dom";

import { HeldEventDetailLoading } from "@/features/heldEvents/detail/HeldEventDetailStatusViews";
import { useLatestHeldEvent } from "@/features/heldEvents/latest/useLatestHeldEvent";
import { ResourcePageState } from "@/shared/ui/feedback/ResourcePageState";

/**
 * The app's entry and the global 記録する action open the newest held event's hub, where the next
 * match is recorded or a new held event is started. With no held event yet, the held-event history
 * offers creating the first one.
 */
export function LatestHeldEventRedirect() {
  const latest = useLatestHeldEvent();

  switch (latest.kind) {
    case "loading":
      return <HeldEventDetailLoading />;
    case "failed":
      return (
        <ResourcePageState
          backHref="/held-events"
          backLabel="開催履歴へ"
          description="通信状態を確認して、もう一度お試しください。"
          kind="error"
          retryLabel="再読み込み"
          retrying={latest.retrying}
          title="最新の開催を確認できませんでした"
          width="analysis"
          onRetry={latest.retry}
        />
      );
    case "none":
      return <Navigate replace to="/held-events" />;
    case "found":
      return <Navigate replace to={latest.href} />;
  }
}
