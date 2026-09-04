import { Download, ListFilter, RefreshCw } from "lucide-react";

import { Button } from "@/shared/ui/actions/Button";
import { LinkButton } from "@/shared/ui/actions/LinkButton";
import { responsivePageHeaderLeadActionGroupClass } from "@/shared/ui/layout/PageHeader";

type HeldEventDetailHeaderActionsProps = {
  exportHref: string;
  matchesHref: string;
  refresh?:
    | {
        pending: boolean;
        run: () => void;
      }
    | undefined;
};

/** Keeps route-known detail navigation stable while the optional refresh command changes state. */
export function HeldEventDetailHeaderActions({
  exportHref,
  matchesHref,
  refresh,
}: HeldEventDetailHeaderActionsProps) {
  return (
    <nav
      aria-label="この開催の関連操作"
      className={responsivePageHeaderLeadActionGroupClass}
      data-page-header-actions="responsive-lead"
    >
      <LinkButton
        icon={<ListFilter aria-hidden="true" />}
        size="sm"
        to={matchesHref}
        variant="quiet"
      >
        試合検索で見る
      </LinkButton>
      <LinkButton icon={<Download aria-hidden="true" />} size="sm" to={exportHref} variant="quiet">
        CSV出力
      </LinkButton>
      {refresh ? (
        <Button
          aria-label="開催詳細を更新"
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
