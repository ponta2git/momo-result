import { Download } from "lucide-react";

import { formatMatchNo } from "@/features/matches/list/matchListFormat";
import type { MatchListItemView } from "@/features/matches/list/matchListTypes";
import { IconLink } from "@/shared/ui/actions/IconLink";

type MatchListExportLinkProps = {
  disabled?: boolean;
  item: MatchListItemView;
};

export function MatchListExportLink({ disabled = false, item }: MatchListExportLinkProps) {
  if (!item.exportHref) {
    return null;
  }

  const label = `${formatMatchNo(item.matchNoInEvent)}をCSV/TSV出力`;

  return (
    <IconLink
      disabled={disabled}
      aria-label={label}
      icon={<Download />}
      to={item.exportHref}
      tooltip="CSV/TSV出力へ"
      variant="quiet"
    />
  );
}
