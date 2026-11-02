import { Award, BookOpen } from "lucide-react";

import { AchievementClaimEditorDialog } from "@/features/achievements/AchievementClaimEditorDialog";
import { AchievementDetailsDialog } from "@/features/achievements/AchievementDetailsDialog";
import {
  AchievementPointsSkeleton,
  AchievementPointsSummary,
} from "@/features/achievements/AchievementPointsSummary";
import { AchievementRecordDialog } from "@/features/achievements/AchievementRecordDialog";
import { useAchievementsPage } from "@/features/achievements/useAchievementsPage";
import { AchievementDifficulty } from "@/shared/achievements/AchievementDifficulty";
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
import { compactBadgeToneClass } from "@/shared/ui/status/badgeRecipes";
import { contentText } from "@/shared/ui/typography";

/**
 * The achievement page is where friends celebrate, so a first achievement reads as a stamp on
 * the shared table: the success fill, the medal, and the bold word mark the moment, while the
 * cells still to come stay plain text and never read as a failure.
 */
const achievedStampClass = cn(
  "inline-flex min-h-7 items-center gap-1 whitespace-nowrap rounded-xs border px-2 text-sm/5 font-emphasis",
  compactBadgeToneClass.success,
);

export function AchievementsPage() {
  const {
    editingClaimId,
    closeCorrection,
    newRecord,
    closeNewRecord,
    recordAchievement,
    operations,
    titles,
    titlesLoading,
    titlesFailed,
    gameTitleId,
    publication,
    catalog,
    catalogLoading,
    catalogFailed,
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
    openDetails,
    editClaim,
    refresh,
  } = useAchievementsPage();
  // Until the first title, catalog, or publication answer arrives, the sections keep their
  // final headings and spacing with placeholders instead of a differently shaped block.
  const initialLoading =
    !data && !catalog && (publication.loading || titlesLoading || catalogLoading);
  // Published points and statuses are not inferred from the catalog while they are loading.
  const publicationPending = !data && (publication.loading || initialLoading);
  return (
    <PageFrame width="analysis">
      <PageContentSurface aria-label="実績達成" role="region" className="grid min-w-0 gap-6">
        <div className="flex flex-wrap items-end gap-2">
          {/* A fixed slot keeps the actions in place whatever the selected title's length. */}
          <div className="w-full sm:w-80">
            <SelectField
              label="作品"
              value={gameTitleId ?? ""}
              options={[
                { value: "", label: "作品を選択" },
                ...titles.map((title) => ({
                  value: title.id,
                  label: title.name,
                })),
              ]}
              onValueChange={(value) => changeTitle(value)}
            />
          </div>
          <Button variant="secondary" pending={refreshing} pendingLabel="更新中" onClick={refresh}>
            表示を更新
          </Button>
          {operations.allowed ? (
            <LinkButton to="/admin/masters?tab=achievements" variant="secondary">
              項目を管理
            </LinkButton>
          ) : null}
        </div>
        {titlesFailed ? (
          <Notice tone="danger" title="作品を取得できません">
            通信状態を確認して「表示を更新」を押してください。
          </Notice>
        ) : null}
        <AchievementPublicationFeedback
          status={publication.status}
          statusFailed={publication.statusFailed}
          resourceFailed={publication.resourceFailed}
          hasPublishedData={Boolean(data)}
        />
        {!gameTitleId && !titlesLoading && !titlesFailed ? (
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
        {data || catalog || initialLoading ? (
          <StaleShield active={titleChanged} strategy="preserve-inert" fallback={null}>
            <div aria-busy={initialLoading || undefined} className="grid min-w-0 gap-6">
              <section aria-label="集めたポイント" className="grid min-w-0 gap-2">
                <h2 className={contentText.heading}>集めたポイント</h2>
                {summary ? (
                  <AchievementPointsSummary summary={summary} />
                ) : publicationPending ? (
                  <AchievementPointsSkeleton />
                ) : (
                  <p className={contentText.body}>ポイントはまだ取得できていません。</p>
                )}
              </section>
              <section aria-label="実績リスト" className="grid min-w-0 gap-2">
                <h2 className={contentText.heading}>達成状況</h2>
                {initialLoading ? (
                  <Skeleton className="h-64" />
                ) : (
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
                      {
                        key: "difficulty",
                        header: "難易度",
                        minWidth: "7.5rem",
                        renderCell: (item) => <AchievementDifficulty stars={item.stars} />,
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
                          if (!player && publicationPending)
                            return (
                              <Skeleton as="span" className="inline-block h-5 w-16 align-middle" />
                            );
                          return player?.status === "achieved" ? (
                            <span className={achievedStampClass}>
                              <Award
                                aria-hidden="true"
                                className="size-4 text-[var(--color-success)]"
                              />
                              {achievementStatusLabel(player.status)}
                            </span>
                          ) : (
                            <span className={cn(contentText.body, "whitespace-nowrap")}>
                              {player ? achievementStatusLabel(player.status) : "未取得"}
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
                            onClick={() => openDetails(item.achievementId)}
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
                )}
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
          catalog={catalog}
          catalogLoading={catalogLoading}
          catalogFailed={catalogFailed}
          maps={maps}
          publicationFeedback={
            <AchievementPublicationFeedback
              status={publication.status}
              statusFailed={publication.statusFailed}
              resourceFailed={publication.resourceFailed}
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
            catalog?.items.find((item) => item.achievementId === newRecord.item.achievementId) ??
            newRecord.item
          }
          memberId={newRecord.memberId}
          existingClaim={Boolean(
            catalog?.claims.some(
              (claim) =>
                claim.achievementId === newRecord.item.achievementId &&
                claim.memberId === newRecord.memberId,
            ),
          )}
          onClose={closeNewRecord}
        />
      ) : null}
      {editingClaim && editingItem && gameTitleId ? (
        <AchievementClaimEditorDialog
          key={editingClaim.claimId}
          claim={editingClaim}
          item={editingItem}
          onClose={closeCorrection}
        />
      ) : null}
    </PageFrame>
  );
}
