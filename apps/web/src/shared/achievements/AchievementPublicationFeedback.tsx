import type { SeriesAnalysisStatusResponse } from "@/shared/api/seriesAnalysis";
import { Notice } from "@/shared/ui/feedback/Notice";

export function AchievementPublicationFeedback({
  status,
  statusFailed,
  resourceFailed,
  hasPublishedData,
  refreshMode = "button",
}: {
  status: SeriesAnalysisStatusResponse | undefined;
  statusFailed: boolean;
  resourceFailed: boolean;
  hasPublishedData: boolean;
  /**
   * `page` is for a page without an update control that follows a running calculation by itself
   * (Web rule Server State); a stale result without one still tells the reader to reopen.
   */
  refreshMode?: "button" | "page";
}) {
  if (statusFailed || resourceFailed) {
    return (
      <Notice tone={hasPublishedData ? "warning" : "danger"} title="実績を更新できません">
        {hasPublishedData ? "取得済みの実績を表示しています。" : "達成状況を取得できませんでした。"}
        {refreshMode === "button"
          ? "通信状態を確認して「表示を更新」を押してください。"
          : "通信状態を確認してページを開き直してください。"}
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
  const calculating = calculation === "queued" || calculation === "running";
  if (calculating || status?.artifactFreshness === "stale") {
    // A page follows a running calculation itself; only a stale result without one asks the
    // reader to reopen the page later.
    const recovery =
      refreshMode === "button"
        ? "集計後に「表示を更新」を押してください。"
        : calculating
          ? null
          : "集計後にページを開き直すと反映されます。";
    return (
      <Notice tone="info" title="保存された変更の集計を待っています">
        {hasPublishedData ? "集計前の実績を表示しています。" : "初回の集計が終わると表示できます。"}
        {recovery}
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
