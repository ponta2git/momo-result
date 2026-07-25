import { ClipboardList } from "lucide-react";
import { Link } from "react-router-dom";

import { formatMatchNo } from "@/features/matches/list/matchListFormat";
import type { MatchListItemView } from "@/features/matches/list/matchListTypes";
import { Tooltip } from "@/shared/ui/feedback/Tooltip";

type MatchListResultLinkProps = {
  disabled?: boolean;
  item: MatchListItemView;
};

export function MatchListResultLink({ disabled = false, item }: MatchListResultLinkProps) {
  if (!item.detailHref) {
    return null;
  }

  const label = `${formatMatchNo(item.matchNoInEvent)} ${item.mapName ?? "マップ未設定"}の試合結果を見る`;

  if (disabled) {
    return (
      <span
        aria-disabled="true"
        aria-label={label}
        className="inline-flex size-11 cursor-not-allowed items-center justify-center rounded-[var(--radius-sm)] border border-transparent text-[var(--color-text-muted)] opacity-60"
        role="link"
      >
        <ClipboardList aria-hidden="true" className="size-5" />
      </span>
    );
  }

  return (
    <Tooltip content="試合結果を見る">
      <Link
        aria-label={label}
        className="momo-pressable inline-flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-transparent text-[var(--color-text-secondary)] hover:border-[var(--color-border)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text-primary)]"
        to={item.detailHref}
      >
        <ClipboardList aria-hidden="true" className="size-5" />
      </Link>
    </Tooltip>
  );
}
