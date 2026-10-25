import { Award, CircleHelp, Flag } from "lucide-react";
import type { ReactNode } from "react";

import { AchievementDifficulty } from "@/shared/achievements/AchievementDifficulty";
import {
  achievementDateLabel,
  achievementPageHref,
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
  onRecord,
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
  onRecord: () => void;
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
          <div className="flex flex-wrap items-center gap-2">
            <AchievementDifficulty stars={item.stars} />
            <p className={contentText.supporting}>
              {item.common
                ? "全マップ共通"
                : item.mapMasterIds
                    .map(
                      (id) => maps.find((map) => map.mapMasterId === id)?.displayName ?? "マップ",
                    )
                    .join("・")}
            </p>
          </div>
          {condition ? <p className={contentText.body}>{condition}</p> : null}
          {item.notes.trim() ? (
            <dl className="grid gap-1">
              <dt className={contentText.supporting}>備考</dt>
              <dd className={cn(contentText.body, "whitespace-pre-wrap")}>{item.notes}</dd>
            </dl>
          ) : null}
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
                  onRecord={onRecord}
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
  onRecord,
}: {
  item: AchievementDefinition;
  player: PublishedAchievementPlayer | undefined;
  member: Pick<PublishedAchievementPlayer, "memberId" | "displayName">;
  catalog: AchievementCatalog | undefined;
  onEditClaim: (claimId: string) => void;
  onRecord: () => void;
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
  const matchLinks = (player?.proofs ?? [])
    .flatMap((proof) => {
      if (proof.matchId && proof.matchAvailable)
        return [
          {
            href: `/matches/${encodeURIComponent(proof.matchId)}`,
            label: "試合を振り返る",
            date: proof.achievedAt,
          },
        ];
      if (!proof.matchId && proof.heldEventId && proof.heldEventAvailable)
        return [
          {
            href: `/held-events/${encodeURIComponent(proof.heldEventId)}`,
            label: "4試合を振り返る",
            date: proof.achievedAt,
          },
        ];
      return [];
    })
    .filter((link, index, links) => links.findIndex((value) => value.href === link.href) === index);
  const missingMatch = player?.proofs.some(
    (proof) =>
      (proof.matchId && !proof.matchAvailable) ||
      (!proof.matchId && proof.heldEventId && !proof.heldEventAvailable),
  );
  const unknownMatch =
    player?.status === "achieved" &&
    player.proofs.some((proof) => !proof.matchId && !proof.heldEventId);
  const derivedSources = (player?.proofs ?? [])
    .flatMap((proof) => {
      const source = catalog?.items.find(
        (value) => value.achievementId === proof.sourceAchievementId,
      );
      return source ? [source] : [];
    })
    .filter(
      (source, index, sources) =>
        sources.findIndex((value) => value.achievementId === source.achievementId) === index,
    );
  const canRecord =
    item.ruleKind === "manual" &&
    !item.retired &&
    claims.length === 0 &&
    catalog?.items.some((value) => value.achievementId === item.achievementId && !value.retiredAt);
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
          {missingMatch ? (
            <p className={contentText.supporting}>
              {matchLinks.length > 0
                ? "削除済みの試合による達成もあります。"
                : "達成した試合は削除されています。"}
            </p>
          ) : unknownMatch ? (
            <p className={contentText.supporting}>
              {matchLinks.length > 0
                ? "試合が分からない達成もあります。"
                : "達成した試合は登録されていません。"}
            </p>
          ) : null}
          {matchLinks.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {matchLinks.map((link) => (
                <LinkButton key={link.href} to={link.href} size="sm" variant="secondary">
                  {matchLinks.length > 1 && link.date ? `${formatDateTimeLong(link.date)}・` : ""}
                  {link.label}
                </LinkButton>
              ))}
            </div>
          ) : null}
          {player?.status === "unconfirmed" ? (
            <p className={contentText.body}>
              以前の実績リストでは、達成したかどうかが未確認でした。
            </p>
          ) : null}
        </div>
      </div>
      {player?.status === "not_recorded" && !item.retired ? (
        <p className={contentText.body}>
          {item.ruleKind === "manual"
            ? "達成した試合を選んで記録できます。"
            : "試合結果がこの条件を満たすと、自動で達成になります。"}
        </p>
      ) : null}
      {canRecord ? (
        <div>
          <Button variant="secondary" onClick={onRecord}>
            達成を記録する
          </Button>
        </div>
      ) : null}
      {item.ruleKind === "manual" && derivedSources.length > 0 ? (
        <div className="grid justify-items-start gap-2">
          <p className={contentText.supporting}>この達成には、次の実績の記録も含まれています。</p>
          {derivedSources.map((source) => (
            <LinkButton
              key={source.achievementId}
              variant="quiet"
              size="sm"
              to={achievementPageHref(source.gameTitleId, source.achievementId, member.memberId)}
            >
              「{source.name}」の記録を直す
            </LinkButton>
          ))}
        </div>
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
