import { Clock3 } from "lucide-react";

import type { SeriesAnalysisStatusResponse } from "@/shared/api/seriesAnalysis";
import { formatDateTimeLong } from "@/shared/lib/dateTime";
import { Button } from "@/shared/ui/actions/Button";
import { EmptyState } from "@/shared/ui/feedback/EmptyState";
import { Notice } from "@/shared/ui/feedback/Notice";

export function SeriesAnalysisStatusFeedback({
  confirmedMatchCount,
  hasError,
  loading,
  onRefresh,
  refreshing,
  status,
}: {
  confirmedMatchCount: number;
  hasError: boolean;
  loading: boolean;
  onRefresh: () => void;
  refreshing: boolean;
  status: SeriesAnalysisStatusResponse | undefined;
}) {
  if (loading && !status) return null;
  if (!status?.currentArtifact) {
    return (
      <NoArtifactFeedback
        confirmedMatchCount={confirmedMatchCount}
        hasError={hasError}
        refreshing={refreshing}
        status={status}
        onRefresh={onRefresh}
      />
    );
  }
  if (hasError) {
    return (
      <Notice tone="warning" title="計算状態を確認できません">
        <p>取得済みの分析はそのまま表示します。</p>
        <RefreshAction refreshing={refreshing} onRefresh={onRefresh} />
      </Notice>
    );
  }

  const calculation = status.calculation;
  if (calculation?.status === "queued" || calculation?.status === "running") {
    const recalculatingCurrent = status.artifactFreshness === "current";
    const title = recalculatingCurrent
      ? calculation.status === "queued"
        ? "分析データの再計算を待っています"
        : "分析データを再計算中です"
      : calculation.status === "queued"
        ? "新しい戦績データの計算を待っています"
        : "新しい戦績データを計算中です";
    return (
      <Notice tone="info" title={title}>
        完了まで、{lastUpdatedText(status)}を表示します。
      </Notice>
    );
  }
  if (calculation?.status === "failed" || calculation?.status === "timed_out") {
    return (
      <Notice
        tone="warning"
        title={
          calculation.status === "timed_out"
            ? "分析データの再計算が時間内に完了しませんでした"
            : "分析データを再計算できませんでした"
        }
      >
        {lastUpdatedText(status)}を表示しています。
      </Notice>
    );
  }
  if (status.artifactFreshness === "stale") {
    return (
      <Notice tone="warning" title="新しい試合結果はまだ反映されていません">
        {lastUpdatedText(status)}を表示しています。
      </Notice>
    );
  }
  return null;
}

function NoArtifactFeedback({
  confirmedMatchCount,
  hasError,
  onRefresh,
  refreshing,
  status,
}: {
  confirmedMatchCount: number;
  hasError: boolean;
  onRefresh: () => void;
  refreshing: boolean;
  status: SeriesAnalysisStatusResponse | undefined;
}) {
  const calculationStatus = status?.calculation?.status;
  const copy = hasError
    ? {
        description: "通信状態を確認して、もう一度お試しください。",
        title: "戦績データを取得できません",
      }
    : calculationStatus === "queued" || calculationStatus === "running"
      ? {
          description: "計算完了後に「状態を再確認」を押すと表示します。",
          title:
            calculationStatus === "queued"
              ? "戦績データの計算を待っています"
              : "戦績データを計算中です",
        }
      : calculationStatus === "failed" || calculationStatus === "timed_out"
        ? {
            description:
              "表示できる成功済みデータはまだありません。管理者に再計算を依頼してください。",
            title:
              calculationStatus === "timed_out"
                ? "戦績データの計算が時間内に完了しませんでした"
                : "戦績データを計算できませんでした",
          }
        : confirmedMatchCount === 0
          ? {
              description: "試合を確定すると、戦績分析を作成します。",
              title: "対戦データがありません",
            }
          : {
              description: "管理者に再計算を依頼してください。",
              title: "表示できる分析データがありません",
            };

  return (
    <EmptyState
      action={
        <Button
          pending={refreshing}
          pendingLabel="状態を確認中"
          variant={hasError ? "primary" : "secondary"}
          onClick={onRefresh}
        >
          状態を再確認
        </Button>
      }
      description={copy.description}
      icon={<Clock3 className="size-5" />}
      placement="embedded"
      title={copy.title}
    />
  );
}

function RefreshAction({ onRefresh, refreshing }: { onRefresh: () => void; refreshing: boolean }) {
  return (
    <div className="mt-3">
      <Button
        pending={refreshing}
        pendingLabel="状態を確認中"
        size="sm"
        variant="secondary"
        onClick={onRefresh}
      >
        状態を再確認
      </Button>
    </div>
  );
}

function lastUpdatedText(status: SeriesAnalysisStatusResponse): string {
  return status.currentArtifact
    ? `${formatDateTimeLong(status.currentArtifact.publishedAt)}更新のデータ`
    : "前回の成功済みデータ";
}
