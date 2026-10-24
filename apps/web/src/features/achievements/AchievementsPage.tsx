import { Award } from "lucide-react";

import { AchievementClaimEditorDialog } from "@/features/achievements/AchievementClaimEditorDialog";
import { AchievementDetailsDialog } from "@/features/achievements/AchievementDetailsDialog";
import { useAchievementsPage } from "@/features/achievements/useAchievementsPage";
import {
  achievementDateLabel,
  achievementStatusLabel,
} from "@/shared/achievements/achievementPresentation";
import { AchievementPublicationFeedback } from "@/shared/achievements/AchievementPublicationFeedback";
import { AchievementScoreTable } from "@/shared/achievements/AchievementScoreTable";
import {
  canonicalResultMembers,
  memberDisplayName,
  orderFixedMembers,
} from "@/shared/domain/members";
import { MemberSequenceLabel } from "@/shared/matches/MemberSequenceLabel";
import { Button } from "@/shared/ui/actions/Button";
import { LinkButton } from "@/shared/ui/actions/LinkButton";
import { cn } from "@/shared/ui/cn";
import { Disclosure } from "@/shared/ui/data/Collapsible";
import { DataTable } from "@/shared/ui/data/DataTable";
import { EmptyState } from "@/shared/ui/feedback/EmptyState";
import { Notice } from "@/shared/ui/feedback/Notice";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";
import { SelectField } from "@/shared/ui/forms/SelectField";
import { ContentWithActions } from "@/shared/ui/layout/ContentWithActions";
import { PageContentSurface } from "@/shared/ui/layout/PageContentSurface";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import { StaleShield } from "@/shared/ui/motion/StaleShield";
import { contentText } from "@/shared/ui/typography";

export function AchievementsPage() {
  const {
    setSearch,
    editingClaimId,
    setEditingClaimId,
    operations,
    titles,
    gameTitleId,
    mapMasterId,
    publication,
    catalog,
    data,
    titleChanged,
    invalidMap,
    summary,
    items,
    claims,
    selectedItem,
    selectedPlayer,
    editingClaim,
    editingItem,
    refreshing,
    changeSelection,
    closeDetails,
    editClaim,
    refresh,
  } = useAchievementsPage();
  return (
    <PageFrame width="wide">
      <PageContentSurface aria-label="実績達成" role="region" className="grid min-w-0 gap-6">
        <div className="flex flex-wrap items-end gap-4">
          <SelectField
            label="作品"
            value={gameTitleId ?? ""}
            options={[
              { value: "", label: "作品を選択" },
              ...(titles.data?.items ?? []).map((title) => ({
                value: title.id,
                label: title.name,
              })),
            ]}
            onValueChange={(value) => changeSelection("gameTitleId", value)}
          />
          <SelectField
            label="対象マップ"
            value={mapMasterId}
            options={[
              { value: "", label: "全マップ" },
              ...(data?.maps ?? []).map((map) => ({
                value: map.mapMasterId,
                label: map.displayName,
              })),
            ]}
            onValueChange={(value) => changeSelection("mapMasterId", value)}
          />
          <Button variant="secondary" pending={refreshing} pendingLabel="更新中" onClick={refresh}>
            表示を更新
          </Button>
          {operations.allowed ? (
            <LinkButton to="/admin/masters?tab=achievements" variant="secondary">
              項目を管理
            </LinkButton>
          ) : null}
        </div>
        {titles.isError ? (
          <Notice tone="danger" title="作品を取得できません">
            通信状態を確認して「表示を更新」を押してください。
          </Notice>
        ) : null}
        {invalidMap ? (
          <Notice
            tone="warning"
            title="指定されたマップが見つかりません"
            action={
              <Button
                variant="secondary"
                size="sm"
                onClick={() => changeSelection("mapMasterId", "")}
              >
                全マップに戻す
              </Button>
            }
          >
            対象マップを選び直してください。
          </Notice>
        ) : null}
        <AchievementPublicationFeedback
          status={publication.status.data}
          statusFailed={publication.status.isError}
          resourceFailed={publication.resource.isError}
          hasPublishedData={Boolean(data)}
        />
        {!data &&
        (publication.status.isLoading || publication.resource.isLoading || titles.isLoading) ? (
          <div aria-label="実績を読み込み中" className="grid gap-4">
            <Skeleton className="h-20" />
            <Skeleton className="h-64" />
          </div>
        ) : null}
        {!gameTitleId && !titles.isLoading && !titles.isError ? (
          <EmptyState
            icon={<Award />}
            title="作品が登録されていません"
            description="実績を管理する作品を設定してください。"
            placement="embedded"
            action={
              operations.allowed ? (
                <LinkButton to="/admin/masters">作品を設定</LinkButton>
              ) : (
                <LinkButton to="/matches">試合一覧を開く</LinkButton>
              )
            }
          />
        ) : null}
        {data ? (
          <StaleShield active={titleChanged} strategy="preserve-inert" fallback={null}>
            <div className="grid min-w-0 gap-6">
              <section aria-label="実績達成" className="grid min-w-0 gap-3">
                <h2 className={cn(contentText.heading, "text-balance")}>実績達成</h2>
                {summary ? (
                  <AchievementScoreTable
                    players={orderFixedMembers(summary.players).map((player) => ({
                      ...player,
                      displayName: player.displayName,
                      totalPoints: summary.totalPoints,
                    }))}
                  />
                ) : (
                  <p className={contentText.body}>このマップの実績は集計待ちです。</p>
                )}
              </section>
              <section aria-label="実績リスト" className="grid min-w-0 gap-3">
                <h2 className={contentText.heading}>達成状況</h2>
                <DataTable
                  caption={{ content: "実績と4人の達成状況" }}
                  columns={[
                    {
                      key: "achievement",
                      header: "実績",
                      rowHeader: true,
                      minWidth: "15rem",
                      renderCell: (item) => (
                        <div className="grid gap-1">
                          <p className={cn(contentText.body, "text-pretty")}>{item.name}</p>
                          <p className={contentText.supporting}>
                            <span aria-label={`難易度：星${item.stars}`}>
                              {"★".repeat(item.stars)}
                            </span>
                            ・
                            {item.common
                              ? "全マップ共通"
                              : item.mapMasterIds
                                  .map(
                                    (id) =>
                                      data.maps.find((map) => map.mapMasterId === id)
                                        ?.displayName ?? "マップ",
                                  )
                                  .join("・")}
                          </p>
                          {item.notes ? (
                            <p className={cn(contentText.supporting, "text-pretty")}>
                              {item.notes}
                            </p>
                          ) : null}
                        </div>
                      ),
                    },
                    ...canonicalResultMembers.map((member) => ({
                      key: member.memberId,
                      header: (
                        <MemberSequenceLabel memberId={member.memberId}>
                          {member.displayName}
                        </MemberSequenceLabel>
                      ),
                      minWidth: "8rem",
                      renderCell: (item: (typeof items)[number]) => {
                        const player = item.players.find(
                          (value) => value.memberId === member.memberId,
                        );
                        if (!player) return "未取得";
                        const date = achievementDateLabel(player);
                        return (
                          <div className="grid justify-items-start gap-1">
                            <Button
                              variant="quiet"
                              size="sm"
                              aria-label={`${item.name}・${member.displayName}の${achievementStatusLabel(player.status)}`}
                              onClick={() =>
                                setSearch((previous) => {
                                  const next = new URLSearchParams(previous);
                                  next.set("gameTitleId", gameTitleId ?? data.gameTitleId);
                                  next.set("achievementId", item.achievementId);
                                  next.set("memberId", player.memberId);
                                  return next;
                                })
                              }
                            >
                              {achievementStatusLabel(player.status)}
                            </Button>
                            {date ? (
                              <p className={cn(contentText.supporting, "tabular-nums")}>{date}</p>
                            ) : null}
                          </div>
                        );
                      },
                    })),
                  ]}
                  rows={items}
                  getRowKey={(item) => item.achievementId}
                  stickyRowHeader
                  verticalAlign="top"
                  emptyState={<p>対象の実績はありません。</p>}
                />
              </section>
            </div>
          </StaleShield>
        ) : null}
        <Disclosure
          summary="保存済みの記録を訂正"
          ariaLabel="保存済みの実績記録を訂正"
          triggerVariant="supporting"
          panelSpacing="sm"
        >
          <div className="grid gap-4">
            <p className={contentText.supporting}>
              訂正した内容は、集計が終わると達成状況に反映されます。
            </p>
            {catalog.isError ? (
              <Notice tone="danger" title="保存済みの記録を取得できません">
                「表示を更新」で再取得してください。
              </Notice>
            ) : null}
            {catalog.isLoading ? <Skeleton className="h-24" /> : null}
            {catalog.data && claims.length === 0 ? (
              <p className={contentText.body}>手入力・移行の記録はありません。</p>
            ) : null}
            <ul className="grid gap-4">
              {claims.map(({ claim, item }) => (
                <li key={claim.claimId}>
                  <ContentWithActions
                    actions={
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => editClaim(claim.claimId)}
                        aria-label={`${item.name}・${memberDisplayName(claim.memberId)}の${claim.sourceKind === "import" ? "移行記録" : "手入力"}を訂正`}
                      >
                        訂正
                      </Button>
                    }
                  >
                    <div className="grid gap-1">
                      <p className={contentText.body}>
                        {item.name}・{memberDisplayName(claim.memberId)}
                      </p>
                      <p className={contentText.supporting}>
                        {claim.sourceKind === "import" ? "移行時の申告" : "手入力"}・
                        {claim.state === "cancelled"
                          ? "取消済み"
                          : claim.state === "unconfirmed"
                            ? "未確認"
                            : "達成済み"}
                      </p>
                    </div>
                  </ContentWithActions>
                </li>
              ))}
            </ul>
          </div>
        </Disclosure>
      </PageContentSurface>
      {selectedItem && selectedPlayer && !editingClaimId ? (
        <AchievementDetailsDialog
          item={selectedItem}
          player={selectedPlayer}
          catalog={catalog.data}
          onClose={closeDetails}
          onEditClaim={editClaim}
        />
      ) : null}
      {editingClaim && editingItem && gameTitleId ? (
        <AchievementClaimEditorDialog
          key={editingClaim.claimId}
          claim={editingClaim}
          item={editingItem}
          onClose={() => setEditingClaimId(undefined)}
        />
      ) : null}
    </PageFrame>
  );
}
