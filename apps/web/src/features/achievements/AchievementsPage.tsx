import { Award, BookOpen } from "lucide-react";

import { AchievementClaimEditorDialog } from "@/features/achievements/AchievementClaimEditorDialog";
import { AchievementDetailsDialog } from "@/features/achievements/AchievementDetailsDialog";
import { AchievementPointsSummary } from "@/features/achievements/AchievementPointsSummary";
import { AchievementRecordDialog } from "@/features/achievements/AchievementRecordDialog";
import { useAchievementsPage } from "@/features/achievements/useAchievementsPage";
import { achievementStatusLabel } from "@/shared/achievements/achievementPresentation";
import { AchievementPublicationFeedback } from "@/shared/achievements/AchievementPublicationFeedback";
import { canonicalResultMembers } from "@/shared/domain/members";
import { MemberSequenceLabel } from "@/shared/matches/MemberSequenceLabel";
import { Button } from "@/shared/ui/actions/Button";
import { LinkButton } from "@/shared/ui/actions/LinkButton";
import { cn } from "@/shared/ui/cn";
import { DataTable } from "@/shared/ui/data/DataTable";
import { EmptyState } from "@/shared/ui/feedback/EmptyState";
import { Notice } from "@/shared/ui/feedback/Notice";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";
import { SelectField } from "@/shared/ui/forms/SelectField";
import { PageContentSurface } from "@/shared/ui/layout/PageContentSurface";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import { StaleShield } from "@/shared/ui/motion/StaleShield";
import { contentText } from "@/shared/ui/typography";

export function AchievementsPage() {
  const {
    setSearch,
    editingClaimId,
    setEditingClaimId,
    newRecord,
    setNewRecord,
    recordAchievement,
    operations,
    titles,
    gameTitleId,
    publication,
    catalog,
    data,
    titleChanged,
    summary,
    items,
    maps,
    selectedItem,
    selectedMember,
    changeMember,
    editingClaim,
    editingItem,
    refreshing,
    changeTitle,
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
            onValueChange={(value) => changeTitle(value)}
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
        <AchievementPublicationFeedback
          status={publication.status.data}
          statusFailed={publication.status.isError}
          resourceFailed={publication.resource.isError}
          hasPublishedData={Boolean(data)}
        />
        {!data &&
        !catalog.data &&
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
        {data || catalog.data ? (
          <StaleShield active={titleChanged} strategy="preserve-inert" fallback={null}>
            <div className="grid min-w-0 gap-6">
              <section aria-label="集めたポイント" className="grid min-w-0 gap-4">
                <h2 className={contentText.heading}>集めたポイント</h2>
                {summary ? (
                  <AchievementPointsSummary summary={summary} />
                ) : (
                  <p className={contentText.body}>ポイントはまだ取得できていません。</p>
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
                      minWidth: "8rem",
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
                                      maps.find((map) => map.mapMasterId === id)?.displayName ??
                                      "マップ",
                                  )
                                  .join("・")}
                          </p>
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
                      minWidth: "7rem",
                      renderCell: (item: (typeof items)[number]) => {
                        const player = item.players.find(
                          (value) => value.memberId === member.memberId,
                        );
                        return (
                          <span className="inline-flex items-center gap-1 whitespace-nowrap">
                            {player?.status === "achieved" ? (
                              <Award
                                aria-hidden="true"
                                className="size-4 text-[var(--color-success)]"
                              />
                            ) : null}
                            <span
                              className={
                                player?.status === "achieved"
                                  ? contentText.compactPrimary
                                  : contentText.body
                              }
                            >
                              {player ? achievementStatusLabel(player.status) : "未取得"}
                            </span>
                          </span>
                        );
                      },
                    })),
                    {
                      key: "records",
                      header: "記録",
                      minWidth: "9rem",
                      renderCell: (item) => (
                        <Button
                          variant="secondary"
                          size="sm"
                          icon={<BookOpen />}
                          aria-label={`${item.name}の記録を見る`}
                          onClick={() =>
                            setSearch((previous) => {
                              const next = new URLSearchParams(previous);
                              if (gameTitleId) next.set("gameTitleId", gameTitleId);
                              next.set("achievementId", item.achievementId);
                              next.delete("memberId");
                              return next;
                            })
                          }
                        >
                          記録を見る
                        </Button>
                      ),
                    },
                  ]}
                  rows={items}
                  getRowKey={(item) => item.achievementId}
                  stickyRowHeader
                  emptyState={<p>対象の実績はありません。</p>}
                />
              </section>
            </div>
          </StaleShield>
        ) : null}
      </PageContentSurface>
      {selectedItem && selectedMember && !editingClaimId && !newRecord ? (
        <AchievementDetailsDialog
          item={selectedItem}
          players={selectedItem.players}
          memberId={selectedMember.memberId}
          onMemberChange={changeMember}
          catalog={catalog.data}
          catalogLoading={catalog.isLoading}
          catalogFailed={catalog.isError}
          maps={maps}
          publicationFeedback={
            <AchievementPublicationFeedback
              status={publication.status.data}
              statusFailed={publication.status.isError}
              resourceFailed={publication.resource.isError}
              hasPublishedData={Boolean(data)}
            />
          }
          refreshing={refreshing}
          onRefresh={refresh}
          onClose={closeDetails}
          onEditClaim={editClaim}
          onRecord={recordAchievement}
        />
      ) : null}
      {newRecord ? (
        <AchievementRecordDialog
          item={
            catalog.data?.items.find(
              (item) => item.achievementId === newRecord.item.achievementId,
            ) ?? newRecord.item
          }
          memberId={newRecord.memberId}
          existingClaim={Boolean(
            catalog.data?.claims.some(
              (claim) =>
                claim.achievementId === newRecord.item.achievementId &&
                claim.memberId === newRecord.memberId,
            ),
          )}
          onClose={() => setNewRecord(undefined)}
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
