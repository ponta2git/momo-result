import { orderFixedMembers } from "@/shared/domain/members";
import { MemberSequenceLabel } from "@/shared/matches/MemberSequenceLabel";
import type { PlayerAchievementScore } from "@/shared/seriesAnalysis/playerRadarPresentation";
import { playerAchievementScoreLabel } from "@/shared/seriesAnalysis/playerRadarPresentation";
import { cn } from "@/shared/ui/cn";
import { DataTable } from "@/shared/ui/data/DataTable";
import { contentText } from "@/shared/ui/typography";

export type AchievementScorePlayer = PlayerAchievementScore & {
  memberId: string;
  displayName: string;
};

export function AchievementScoreTable({ players }: { players: readonly AchievementScorePlayer[] }) {
  return (
    <DataTable
      caption={{ content: "実績達成の点数とポイント" }}
      columns={[
        {
          key: "member",
          header: "プレーヤー",
          rowHeader: true,
          renderCell: (player) => (
            <MemberSequenceLabel memberId={player.memberId}>
              {player.displayName}
            </MemberSequenceLabel>
          ),
        },
        {
          key: "score",
          header: "点数",
          tabular: true,
          renderCell: (player) => (
            <span className={cn(contentText.compactPrimary, "whitespace-nowrap")}>
              {playerAchievementScoreLabel(player)}
            </span>
          ),
        },
        {
          key: "points",
          header: "獲得／対象ポイント",
          tabular: true,
          renderCell: (player) => `${player.earnedPoints}／${player.totalPoints}`,
        },
      ]}
      getRowKey={(player) => player.memberId}
      rows={orderFixedMembers(players)}
      density="compact"
    />
  );
}
