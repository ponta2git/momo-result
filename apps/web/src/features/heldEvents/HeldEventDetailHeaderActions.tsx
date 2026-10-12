import { Download, RefreshCw } from "lucide-react";

import { inlineActionGroupClass } from "@/shared/ui/actions/actionGroup";
import { Button } from "@/shared/ui/actions/Button";
import { LinkButton } from "@/shared/ui/actions/LinkButton";

type HeldEventDetailHeaderActionsProps = {
  exportHref: string;
  refresh?:
    | {
        pending: boolean;
        disabled?: boolean;
        run: () => void;
      }
    | undefined;
};

/** Offers operations for the loaded event and its current refresh state. */
export function HeldEventDetailHeaderActions({
  exportHref,
  refresh,
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
    </nav>
  );
}
