import {
  achievementDateLabel,
  achievementProofLabel,
  achievementStatusLabel,
} from "@/shared/achievements/achievementPresentation";
import type {
  PublishedAchievement,
  PublishedAchievementPlayer,
} from "@/shared/achievements/achievementPresentation";
import type { AchievementCatalog } from "@/shared/api/achievements";
import { memberDisplayName } from "@/shared/domain/members";
import { formatDateTimeLong } from "@/shared/lib/dateTime";
import { Button } from "@/shared/ui/actions/Button";
import { LinkButton } from "@/shared/ui/actions/LinkButton";
import { cn } from "@/shared/ui/cn";
import { Dialog } from "@/shared/ui/feedback/Dialog";
import { ContentWithActions } from "@/shared/ui/layout/ContentWithActions";
import { contentText } from "@/shared/ui/typography";

export function AchievementDetailsDialog({
  item,
  player,
  catalog,
  onClose,
  onEditClaim,
}: {
  item: PublishedAchievement;
  player: PublishedAchievementPlayer;
  catalog: AchievementCatalog | undefined;
  onClose: () => void;
  onEditClaim: (claimId: string) => void;
}) {
  const claims =
    catalog?.claims.filter(
      (claim) => claim.achievementId === item.achievementId && claim.memberId === player.memberId,
    ) ?? [];
  const frozen = item.retired && item.ruleKind !== "manual";
  return (
    <Dialog
      open
      title={`${item.name}・${player.displayName}`}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <div className="grid gap-6">
        <div className="grid gap-1">
          <p className={contentText.compactPrimary}>{achievementStatusLabel(player.status)}</p>
          {achievementDateLabel(player) ? (
            <p className={cn(contentText.body, "tabular-nums")}>{achievementDateLabel(player)}</p>
          ) : null}
          {player.dateUnknown && player.firstAchievedAt ? (
            <p className={contentText.supporting}>
              日時不明の達成があるため、実際の初達成日時は確定していません。
            </p>
          ) : null}
          {item.retired ? (
            <p className={contentText.supporting}>
              {frozen ? "廃止時点の記録です。" : "廃止した実績の記録です。"}
            </p>
          ) : null}
        </div>
        <section aria-label="達成の根拠" className="grid gap-3">
          <h2 className={cn(contentText.heading, "text-balance")}>達成の根拠</h2>
          {player.proofs.length === 0 ? (
            <p className={contentText.body}>達成の根拠は記録されていません。</p>
          ) : null}
          <ul className="grid gap-4">
            {player.proofs.map((proof, index) => (
              <li
                key={`${proof.kind}:${proof.claimId ?? proof.matchId ?? proof.heldEventId ?? index}`}
              >
                <ContentWithActions
                  actions={
                    proof.matchId && proof.matchAvailable ? (
                      <LinkButton
                        to={`/matches/${encodeURIComponent(proof.matchId)}`}
                        size="sm"
                        variant="quiet"
                      >
                        根拠の試合を開く
                      </LinkButton>
                    ) : !proof.matchId && proof.heldEventId && proof.heldEventAvailable ? (
                      <LinkButton
                        to={`/held-events/${encodeURIComponent(proof.heldEventId)}`}
                        size="sm"
                        variant="quiet"
                      >
                        根拠の開催を開く
                      </LinkButton>
                    ) : null
                  }
                >
                  <div className="grid gap-1">
                    <p className={contentText.body}>
                      {proof.sourceAchievementId
                        ? `${catalog?.items.find((source) => source.achievementId === proof.sourceAchievementId)?.name ?? "上位実績"}から補完`
                        : achievementProofLabel(proof.kind)}
                      {proof.state === "unconfirmed" ? "・未確認" : ""}
                    </p>
                    <p className={cn(contentText.supporting, "tabular-nums")}>
                      {proof.achievedAt ? formatDateTimeLong(proof.achievedAt) : "日時不明"}
                    </p>
                    {proof.matchId && !proof.matchAvailable ? (
                      <p className={contentText.supporting}>根拠の試合は削除済みです。</p>
                    ) : proof.heldEventId && !proof.heldEventAvailable ? (
                      <p className={contentText.supporting}>根拠の開催は削除済みです。</p>
                    ) : !proof.matchId && !proof.heldEventId ? (
                      <p className={contentText.supporting}>根拠の試合・開催は不明です。</p>
                    ) : null}
                  </div>
                </ContentWithActions>
              </li>
            ))}
          </ul>
        </section>
        {!frozen && claims.length > 0 ? (
          <section aria-label="保存済みの記録の訂正" className="grid justify-items-start gap-2">
            <h2 className={cn(contentText.heading, "text-balance")}>保存済みの記録を訂正</h2>
            {claims.map((claim) => (
              <Button
                key={claim.claimId}
                variant="secondary"
                onClick={() => onEditClaim(claim.claimId)}
              >
                {memberDisplayName(claim.memberId)}の
                {claim.sourceKind === "import" ? "移行時の申告" : "手入力"}を訂正
              </Button>
            ))}
          </section>
        ) : null}
      </div>
    </Dialog>
  );
}
