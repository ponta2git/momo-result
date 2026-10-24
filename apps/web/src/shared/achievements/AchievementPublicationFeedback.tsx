import type { SeriesAnalysisStatusResponse } from "@/shared/api/seriesAnalysis";
import { Notice } from "@/shared/ui/feedback/Notice";

export function AchievementPublicationFeedback({
  status,
  statusFailed,
  resourceFailed,
  hasPublishedData,
}: {
  status: SeriesAnalysisStatusResponse | undefined;
  statusFailed: boolean;
  resourceFailed: boolean;
  hasPublishedData: boolean;
}) {
  if (statusFailed || resourceFailed) {
    return (
      <Notice tone={hasPublishedData ? "warning" : "danger"} title="実績を更新できません">
        {hasPublishedData ? "取得済みの実績を表示しています。" : "達成状況を取得できませんでした。"}
        通信状態を確認して「表示を更新」を押してください。
      </Notice>
    );
  }
  const calculation = status?.calculation?.status;
  if (calculation === "failed" || calculation === "timed_out") {
    return (
      <Notice tone="warning" title="実績の集計に失敗しました">
        保存済みの記録は保持されています。
        {hasPublishedData
          ? "直前に公開された実績を表示しています。"
          : "表示できる集計はまだありません。"}
      </Notice>
    );
  }
  if (
    calculation === "queued" ||
    calculation === "running" ||
    status?.artifactFreshness === "stale"
  ) {
    return (
      <Notice tone="info" title="保存された変更の集計を待っています">
        {hasPublishedData ? "集計前の実績を表示しています。" : "初回の集計が終わると表示できます。"}
        集計後に「表示を更新」を押してください。
      </Notice>
    );
  }
  if (status && !status.currentArtifact) {
    return (
      <Notice tone="info" title="実績はまだ集計されていません">
        表示できる集計がありません。管理者に集計を依頼してください。
      </Notice>
    );
  }
  return null;
}
