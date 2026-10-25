import { Award, CircleHelp, Flag } from "lucide-react";
import type { ReactNode } from "react";

import {
  achievementDateLabel,
  achievementPageHref,
  achievementProofLabel,
  achievementStatusLabel,
} from "@/shared/achievements/achievementPresentation";
import type {
  AchievementDefinition,
  PublishedAchievementPlayer,
} from "@/shared/achievements/achievementPresentation";
import type { AchievementCatalog } from "@/shared/api/achievements";
import { canonicalResultMembers } from "@/shared/domain/members";
import { formatDateTimeLong } from "@/shared/lib/dateTime";
import { formatDecimal, formatManYen } from "@/shared/lib/formatters";
import { MemberSequenceLabel } from "@/shared/matches/MemberSequenceLabel";
import { Button } from "@/shared/ui/actions/Button";
import { LinkButton } from "@/shared/ui/actions/LinkButton";
import { cn } from "@/shared/ui/cn";
import { Disclosure } from "@/shared/ui/data/Collapsible";
import { Dialog, DialogFooter } from "@/shared/ui/feedback/Dialog";
import { Notice } from "@/shared/ui/feedback/Notice";
import { TabsRoot, TabsList, TabsTab, TabsPanel } from "@/shared/ui/forms/Tabs";
import { ContentWithActions } from "@/shared/ui/layout/ContentWithActions";
import { contentText } from "@/shared/ui/typography";

function achievementCondition(item: AchievementDefinition) {
  const threshold = Number(item.threshold);
  switch (item.ruleKind) {
    case "total_assets":
      return `試合終了時の総資産が${formatManYen(threshold)}以上`;
    case "destination":
      return `1試合で目的地に${formatDecimal(threshold)}回以上到着`;
    case "suri_no_ginji":
      return `1試合でスリの銀次に${formatDecimal(threshold)}回以上遭遇`;
    case "event_average_rank":
      return `1開催4試合で平均${formatDecimal(threshold)}位以内`;
    default:
      return null;
  }
}

export function AchievementDetailsDialog({
  item,
  players,
  memberId,
  onMemberChange,
  catalog,
  maps,
  catalogLoading,
  catalogFailed,
  publicationFeedback,
  refreshing,
  onRefresh,
  onClose,
  onEditClaim,
}: {
  item: AchievementDefinition;
  players: readonly PublishedAchievementPlayer[];
  memberId: string;
  onMemberChange: (memberId: string) => void;
  catalog: AchievementCatalog | undefined;
  maps: AchievementCatalog["maps"];
  catalogLoading: boolean;
  catalogFailed: boolean;
  publicationFeedback: ReactNode;
  refreshing: boolean;
  onRefresh: () => void;
  onClose: () => void;
  onEditClaim: (claimId: string) => void;
}) {
  const condition = achievementCondition(item);
  return (
    <Dialog
      open
      title={item.name}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      footer={
        <DialogFooter>
          <Button variant="quiet" pending={refreshing} pendingLabel="更新中" onClick={onRefresh}>
            表示を更新
          </Button>
          <Button variant="secondary" onClick={onClose}>
            閉じる
          </Button>
        </DialogFooter>
      }
    >
      <div className="grid gap-6">
        {publicationFeedback}
        <section aria-label="達成条件" className="grid gap-2">
          <p className={contentText.supporting}>
            <span aria-label={`難易度：星${item.stars}`}>{"★".repeat(item.stars)}</span>・
            {item.common
              ? "全マップ共通"
              : item.mapMasterIds
                  .map((id) => maps.find((map) => map.mapMasterId === id)?.displayName ?? "マップ")
                  .join("・")}
          </p>
          {condition ? <p className={contentText.body}>{condition}</p> : null}
          {item.notes ? <p className={contentText.body}>{item.notes}</p> : null}
          {item.retired ? (
            <p className={contentText.supporting}>
              {item.ruleKind !== "manual" ? "廃止時点の記録です。" : "廃止した実績の記録です。"}
            </p>
          ) : null}
        </section>
        {item.ruleKind === "manual" && catalogFailed ? (
          <Notice tone="warning" title="訂正する記録を読み込めませんでした">
            「表示を更新」で読み直せます。達成状況は取得済みの内容です。
          </Notice>
        ) : item.ruleKind === "manual" && catalogLoading ? (
          <p role="status" className={contentText.supporting}>
            記録を読み込み中
          </p>
        ) : null}
        <TabsRoot value={memberId} onValueChange={(value) => onMemberChange(String(value))}>
          <div className="grid gap-4">
            <TabsList aria-label="プレーヤー" variant="underline" activateOnFocus>
              {canonicalResultMembers.map((member) => (
                <TabsTab key={member.memberId} value={member.memberId}>
                  <MemberSequenceLabel memberId={member.memberId}>
                    {member.displayName}
                  </MemberSequenceLabel>
                </TabsTab>
              ))}
            </TabsList>
            {canonicalResultMembers.map((member) => (
              <TabsPanel key={member.memberId} value={member.memberId}>
                <AchievementPlayerRecord
                  item={item}
                  member={member}
                  player={players.find((player) => player.memberId === member.memberId)}
                  catalog={catalog}
                  onEditClaim={onEditClaim}
                />
              </TabsPanel>
            ))}
          </div>
        </TabsRoot>
      </div>
    </Dialog>
  );
}

function AchievementPlayerRecord({
  item,
  player,
  member,
  catalog,
  onEditClaim,
}: {
  item: AchievementDefinition;
  player: PublishedAchievementPlayer | undefined;
  member: Pick<PublishedAchievementPlayer, "memberId" | "displayName">;
  catalog: AchievementCatalog | undefined;
  onEditClaim: (claimId: string) => void;
}) {
  const claims =
    item.ruleKind === "manual"
      ? (catalog?.claims.filter(
          (claim) =>
            claim.achievementId === item.achievementId && claim.memberId === member.memberId,
        ) ?? [])
      : [];
  const unconfirmedClaim =
    claims.length === 1 && claims[0]?.sourceKind === "import" && claims[0]?.state === "unconfirmed"
      ? claims[0]
      : undefined;
  // The status explanation already identifies an undated, unconfirmed import.
  const proofs = (player?.proofs ?? []).filter(
    (proof) =>
      !(
        player?.status === "unconfirmed" &&
        proof.kind === "import" &&
        !proof.achievedAt &&
        !proof.matchId &&
        !proof.heldEventId
      ),
  );
  const achieved = player?.status === "achieved";
  const points = item.stars ** 2;
  const StateIcon = achieved ? Award : player?.status === "unconfirmed" ? CircleHelp : Flag;
  return (
    <div className="grid gap-6">
      <div className="flex items-start gap-4">
        <StateIcon
          aria-hidden="true"
          className={cn(
            "size-10 shrink-0",
            achieved ? "text-[var(--color-success)]" : "text-[var(--color-text-muted)]",
          )}
        />
        <div className="grid gap-2">
          <p className={contentText.primary}>
            {player ? achievementStatusLabel(player.status) : "達成状況は未取得"}
          </p>
          {player && !item.retired ? (
            <p className={contentText.body}>
              {achieved ? `${points}ポイント獲得` : `達成で${points}ポイント`}
            </p>
          ) : null}
          {player && achievementDateLabel(player) ? (
            <p className={cn(contentText.body, "tabular-nums")}>{achievementDateLabel(player)}</p>
          ) : null}
          {player?.dateUnknown && player.firstAchievedAt ? (
            <p className={contentText.supporting}>日付の分からない達成もあります。</p>
          ) : null}
          {player?.status === "unconfirmed" ? (
            <p className={contentText.body}>
              以前の実績リストでは、達成したかどうかが未確認でした。
            </p>
          ) : null}
        </div>
      </div>
      {player && proofs.length > 0 ? (
        <section aria-label="達成の記録" className="grid gap-3">
          <h2 className={contentText.heading}>達成の記録</h2>
          <ul className="grid gap-4">
            {proofs.map((proof, index) => {
              const source = catalog?.items.find(
                (value) => value.achievementId === proof.sourceAchievementId,
              );
              return (
                <li
                  key={`${proof.kind}:${proof.claimId ?? proof.matchId ?? proof.heldEventId ?? index}`}
                >
                  <ContentWithActions
                    actions={
                      proof.matchId && proof.matchAvailable ? (
                        <LinkButton
                          to={`/matches/${encodeURIComponent(proof.matchId)}`}
                          size="sm"
                          variant="secondary"
                        >
                          試合を振り返る
                        </LinkButton>
                      ) : !proof.matchId && proof.heldEventId && proof.heldEventAvailable ? (
                        <LinkButton
                          to={`/held-events/${encodeURIComponent(proof.heldEventId)}`}
                          size="sm"
                          variant="secondary"
                        >
                          4試合を振り返る
                        </LinkButton>
                      ) : null
                    }
                  >
                    <div className="grid justify-items-start gap-2">
                      <p className={contentText.body}>
                        {proof.sourceAchievementId
                          ? proof.state === "achieved"
                            ? `「${source?.name ?? "上位の実績"}」の達成で、この実績も達成！`
                            : `「${source?.name ?? "上位の実績"}」の達成を確認すると、この実績も達成になります。`
                          : achievementProofLabel(proof.kind)}
                        {proof.state === "unconfirmed" ? "（確認待ち）" : ""}
                      </p>
                      {proof.achievedAt && proof.achievedAt !== player.firstAchievedAt ? (
                        <p className={cn(contentText.supporting, "tabular-nums")}>
                          {formatDateTimeLong(proof.achievedAt)}
                        </p>
                      ) : null}
                      {proof.matchId && !proof.matchAvailable ? (
                        <p className={contentText.supporting}>この試合は削除されています。</p>
                      ) : proof.heldEventId && !proof.heldEventAvailable ? (
                        <p className={contentText.supporting}>この開催は削除されています。</p>
                      ) : !proof.matchId && !proof.heldEventId ? (
                        <p className={contentText.supporting}>達成した試合は登録されていません。</p>
                      ) : null}
                      {source && catalog ? (
                        <LinkButton
                          variant="quiet"
                          size="sm"
                          to={achievementPageHref(
                            catalog.gameTitleId,
                            source.achievementId,
                            member.memberId,
                          )}
                        >
                          元の実績を見る
                        </LinkButton>
                      ) : null}
                    </div>
                  </ContentWithActions>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      {player?.status === "not_recorded" && !item.retired ? (
        <p className={contentText.body}>
          {item.ruleKind === "manual"
            ? "達成したら、その試合の編集画面で実績を記録できます。"
            : "試合結果がこの条件を満たすと、自動で達成になります。"}
        </p>
      ) : null}
      {unconfirmedClaim ? (
        <div>
          <Button
            variant="secondary"
            onClick={() => onEditClaim(unconfirmedClaim.claimId)}
            aria-label="以前の記録：達成を確認する"
          >
            達成を確認する
          </Button>
        </div>
      ) : claims.length > 0 ? (
        <Disclosure summary="記録を直す" panelSpacing="sm" triggerVariant="supporting">
          <ul className="grid gap-4">
            {claims.map((claim) => {
              const source = claim.sourceKind === "import" ? "以前の記録" : "試合で入力した記録";
              const action =
                claim.state === "cancelled"
                  ? "記録を戻す"
                  : claim.state === "unconfirmed"
                    ? "達成を確認する"
                    : "日時・試合・達成を直す";
              return (
                <li key={claim.claimId}>
                  <ContentWithActions
                    actions={
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => onEditClaim(claim.claimId)}
                        aria-label={`${source}：${action}`}
                      >
                        {action}
                      </Button>
                    }
                  >
                    <div className="grid gap-1">
                      <p className={contentText.body}>
                        {source}
                        {claim.state === "cancelled"
                          ? "（取り消し済み）"
                          : claim.state === "unconfirmed"
                            ? "（確認待ち）"
                            : ""}
                      </p>
                      {claim.achievedAt ? (
                        <p className={cn(contentText.supporting, "tabular-nums")}>
                          {formatDateTimeLong(claim.achievedAt)}
                        </p>
                      ) : null}
                    </div>
                  </ContentWithActions>
                </li>
              );
            })}
          </ul>
        </Disclosure>
      ) : null}
    </div>
  );
}
