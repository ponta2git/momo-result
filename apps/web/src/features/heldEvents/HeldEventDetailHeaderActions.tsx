import { Download, RefreshCw } from "lucide-react";

import { inlineActionGroupClass } from "@/shared/ui/actions/actionGroup";
import { Button } from "@/shared/ui/actions/Button";
import { LinkButton } from "@/shared/ui/actions/LinkButton";

type HeldEventDetailHeaderActionsProps = {
  exportHref: string;
  showHistoryLink?: boolean;
  refresh?:
    | {
        pending: boolean;
        disabled?: boolean;
        run: () => void;
      }
    | undefined;
};

/** Keeps route-known detail navigation stable while the optional refresh command changes state. */
export function HeldEventDetailHeaderActions({
  exportHref,
  refresh,
  showHistoryLink = false,
}: HeldEventDetailHeaderActionsProps) {
  return (
    <nav aria-label="この開催の関連操作" className={inlineActionGroupClass}>
      <LinkButton icon={<Download aria-hidden="true" />} size="sm" to={exportHref} variant="quiet">
        CSV出力
      </LinkButton>
      {refresh ? (
        <Button
          aria-label="開催詳細を更新"
          disabled={refresh.disabled}
          icon={<RefreshCw aria-hidden="true" />}
          pending={refresh.pending}
          pendingLabel="更新中"
          size="sm"
          variant="quiet"
          onClick={refresh.run}
        >
          更新
        </Button>
      ) : null}
      {showHistoryLink ? (
        <LinkButton size="sm" to="/held-events" variant="quiet">
          開催履歴を開く
        </LinkButton>
      ) : null}
    </nav>
  );
}
