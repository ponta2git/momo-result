import { ClipboardList } from "lucide-react";

import { formatMatchNo } from "@/features/matches/list/matchListFormat";
import type { MatchListItemView } from "@/features/matches/list/matchListTypes";
import { IconLink } from "@/shared/ui/actions/IconLink";

type MatchListResultLinkProps = {
  disabled?: boolean;
  item: MatchListItemView;
};

export function MatchListResultLink({ disabled = false, item }: MatchListResultLinkProps) {
  if (!item.detailHref) {
    return null;
  }

  const label = `${formatMatchNo(item.matchNoInEvent)} ${item.mapName ?? "マップ未設定"}の試合結果を見る`;

  return (
    <IconLink
      disabled={disabled}
      aria-label={label}
      icon={<ClipboardList />}
      to={item.detailHref}
      tooltip="試合結果を見る"
      variant="quiet"
    />
  );
}
