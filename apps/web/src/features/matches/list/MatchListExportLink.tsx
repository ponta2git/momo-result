import { Download } from "lucide-react";
import { Link } from "react-router-dom";

import { formatMatchNo } from "@/features/matches/list/matchListFormat";
import type { MatchListItemView } from "@/features/matches/list/matchListTypes";
import { Tooltip } from "@/shared/ui/feedback/Tooltip";

type MatchListExportLinkProps = {
  disabled?: boolean;
  item: MatchListItemView;
};

export function MatchListExportLink({ disabled = false, item }: MatchListExportLinkProps) {
  if (!item.exportHref) {
    return null;
  }

  const label = `${formatMatchNo(item.matchNoInEvent)}をCSV/TSV出力`;

  if (disabled) {
    return (
      <span
        aria-disabled="true"
        aria-label={label}
        className="inline-flex size-11 cursor-not-allowed items-center justify-center rounded-[var(--radius-sm)] border border-transparent text-[var(--color-text-muted)] opacity-60"
        role="link"
      >
        <Download aria-hidden="true" className="size-5" />
      </span>
    );
  }

  return (
    <Tooltip content="CSV/TSV出力へ">
      <Link
        aria-label={label}
        className="momo-pressable inline-flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-transparent text-[var(--color-text-secondary)] hover:border-[var(--color-border)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text-primary)]"
        to={item.exportHref}
      >
        <Download aria-hidden="true" className="size-5" />
      </Link>
    </Tooltip>
  );
}
