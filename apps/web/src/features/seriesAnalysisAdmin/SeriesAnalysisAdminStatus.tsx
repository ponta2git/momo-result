import type {
  SeriesAnalysisAdminOverview,
  SeriesAnalysisJobStatus,
  SeriesAnalysisResultDisposition,
  SeriesAnalysisSafeFailureCode,
  SeriesAnalysisTrigger,
} from "@/shared/api/seriesAnalysis";
import { DataTable } from "@/shared/ui/data/DataTable";
import type { DataTableColumn } from "@/shared/ui/data/DataTable";
import { EmptyState } from "@/shared/ui/feedback/EmptyState";
import { Notice } from "@/shared/ui/feedback/Notice";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";
import { StatusBadge } from "@/shared/ui/status/StatusBadge";
import type { StatusBadgeTone } from "@/shared/ui/status/StatusBadge";

export function ExecutionStatus({ data }: { data: SeriesAnalysisAdminOverview }) {
  const execution = data.globalExecution;
  return (
    <section aria-live="polite" className="min-w-0">
      <header className="mb-3">
        <h2 className="font-semibold">全体の実行状況</h2>
      </header>
      <dl className="grid divide-y divide-[var(--color-border)] text-sm sm:grid-cols-4 sm:divide-x sm:divide-y-0">
        <StatusDatum label="実行中" value={`${execution.runningCount}件`} />
        <StatusDatum label="待機作品" value={`${execution.queuedTitleCount}作品`} />
        <StatusDatum label="展開中の全作品操作" value={`${execution.activeCampaignCount}件`} />
        <StatusDatum label="最古の待機" value={formatDateTime(execution.oldestQueuedAt)} />
      </dl>
      {execution.latestActiveCampaign ? (
        <p className="mt-3 text-xs text-[var(--color-text-secondary)]">
          全作品操作: 予約作成{execution.latestActiveCampaign.expandedCount}件／全
          {execution.latestActiveCampaign.targetCount}作品・処理終了
          {execution.latestActiveCampaign.terminalCount}件・失敗
          {execution.latestActiveCampaign.failedCount}件・対象外
          {execution.latestActiveCampaign.skippedCount}件
        </p>
      ) : null}
    </section>
  );
}

export function SelectedTitleStatus({
  selected,
}: {
  selected: SeriesAnalysisAdminOverview["selectedTitle"];
}) {
  if (!selected) return null;
  const status = selected.status;
  return (
    <section className="min-w-0">
      <header className="flex flex-wrap items-center justify-between gap-2 pb-3">
        <h2 className="font-semibold">{selected.gameTitleName}</h2>
        <AnalysisJobStatusBadge announceChanges status={status.calculation?.status ?? "not_run"} />
      </header>
      <dl className="grid divide-y divide-[var(--color-border)] text-sm sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <StatusDatum
          label="成果物"
          value={
            status.artifactFreshness === "current"
              ? "最新"
              : status.artifactFreshness === "stale"
                ? "更新待ち"
                : "未作成"
          }
        />
        <StatusDatum label="最終成功" value={formatDateTime(status.currentArtifact?.publishedAt)} />
        <StatusDatum label="最新の完了" value={formatDateTime(status.calculation?.finishedAt)} />
      </dl>
      {selected.pendingManualRun ? (
        <Notice className="mt-3" tone="info" title="追加の再計算が予約されています">
          {selected.pendingManualRun.requestCount}件・最古{" "}
          {formatDateTime(selected.pendingManualRun.oldestRequestedAt)}
        </Notice>
      ) : null}
    </section>
  );
}

export function RecentJobs({ jobs }: { jobs: SeriesAnalysisAdminOverview["recentJobs"] }) {
  return (
    <section className="min-w-0">
      <header className="mb-3">
        <h2 className="font-semibold">直近3件</h2>
        <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
          全作品を横断した新しい順です。履歴は45日保持します。
        </p>
      </header>
      {jobs.length === 0 ? (
        <EmptyState className="py-6" placement="embedded" title="実行履歴はありません" />
      ) : (
        <DataTable
          caption={{ content: "全作品の直近3件の実行履歴" }}
          columns={recentJobColumns}
          density="compact"
          getRowKey={(job) => job.jobId}
          minWidth="64rem"
          rows={jobs}
        />
      )}
    </section>
  );
}

function StatusDatum({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-4 py-3">
      <dt className="text-xs text-[var(--color-text-secondary)]">{label}</dt>
      <dd className="mt-1 font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function AnalysisJobStatusBadge({
  announceChanges = false,
  status,
}: {
  announceChanges?: boolean | undefined;
  status: SeriesAnalysisJobStatus | "not_run";
}) {
  const model: AnalysisJobStatusViewModel = analysisJobStatusViewModel[status];
  return (
    <StatusBadge
      announceChanges={announceChanges}
      busy={model.busy}
      label={statusLabel(status)}
      tone={model.tone}
    />
  );
}

export function AdminSkeleton() {
  return (
    <div aria-label="戦績分析管理を読み込み中" className="grid gap-3">
      <Skeleton className="min-h-20" />
      <Skeleton className="min-h-28" />
      <Skeleton className="min-h-40" />
    </div>
  );
}

function statusLabel(status: SeriesAnalysisJobStatus | "not_run"): string {
  return statusLabels[status];
}

function triggerLabel(trigger: SeriesAnalysisTrigger): string {
  return triggerLabels[trigger];
}

function failureLabel(code: SeriesAnalysisSafeFailureCode): string {
  return failureLabels[code];
}

function resultLabel(value: SeriesAnalysisResultDisposition): string {
  return resultLabels[value];
}

const statusLabels = {
  failed: "失敗",
  not_run: "未実行",
  queued: "待機中",
  running: "計算中",
  succeeded: "成功",
  timed_out: "タイムアウト",
} as const satisfies Record<SeriesAnalysisJobStatus | "not_run", string>;

type AnalysisJobStatusViewModel = {
  busy?: boolean | undefined;
  tone: StatusBadgeTone;
};

const analysisJobStatusViewModel = {
  failed: { tone: "danger" },
  not_run: { tone: "neutral" },
  queued: { busy: true, tone: "info" },
  running: { busy: true, tone: "info" },
  succeeded: { tone: "success" },
  timed_out: { tone: "danger" },
} as const satisfies Record<SeriesAnalysisJobStatus | "not_run", AnalysisJobStatusViewModel>;

const triggerLabels = {
  algorithm_update: "計算版更新",
  artifact_schema_update: "成果物版更新",
  initial_backfill: "初回計算",
  manual: "手動",
  match_mutation: "試合更新",
} as const satisfies Record<SeriesAnalysisTrigger, string>;

const failureLabels = {
  artifact_too_large: "成果物上限",
  artifact_validation_failed: "成果物検証エラー",
  calculation_failed: "計算エラー",
  dependency_retry_exhausted: "依存先エラー",
  hard_timeout: "時間上限",
  input_contract_invalid: "入力契約違反",
  input_revision_violation: "入力版不整合",
  lease_recovery_exhausted: "実行権回収上限",
  non_deterministic_output: "結果不整合",
  publication_failed: "公開処理エラー",
  resource_exhausted: "メモリ上限",
  temporary_storage_exhausted: "一時領域不足",
  worker_crashed: "分析処理停止",
} as const satisfies Record<SeriesAnalysisSafeFailureCode, string>;

const resultLabels = {
  none: "—",
  published: "公開",
  reused: "既存結果を再利用",
} as const satisfies Record<SeriesAnalysisResultDisposition, string>;

function formatDuration(value: number | null): string {
  return value === null ? "—" : `${formatInteger(value)} ms`;
}

const adminDateTimeFormatter = new Intl.DateTimeFormat("ja-JP", {
  dateStyle: "medium",
  timeZone: "Asia/Tokyo",
  timeStyle: "short",
});
const adminIntegerFormatter = new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 0 });

function formatDateTime(value: string | null | undefined): string {
  return value ? adminDateTimeFormatter.format(new Date(value)) : "—";
}

function formatInteger(value: number): string {
  return adminIntegerFormatter.format(value);
}

type RecentJob = SeriesAnalysisAdminOverview["recentJobs"][number];

const recentJobColumns = [
  {
    header: "作品",
    key: "game-title",
    renderCell: (job) => job.gameTitleName,
    rowHeader: true,
  },
  {
    header: "状態",
    key: "status",
    renderCell: (job) => <AnalysisJobStatusBadge status={job.status} />,
  },
  {
    header: "発火",
    key: "trigger",
    renderCell: (job) => triggerLabel(job.trigger),
  },
  {
    cellClassName: "tabular-nums",
    header: "受理",
    key: "requested-at",
    renderCell: (job) => formatDateTime(job.requestedAt),
  },
  {
    cellClassName: "tabular-nums",
    header: "開始",
    key: "started-at",
    renderCell: (job) => formatDateTime(job.startedAt),
  },
  {
    cellClassName: "tabular-nums",
    header: "完了",
    key: "finished-at",
    renderCell: (job) => formatDateTime(job.finishedAt),
  },
  {
    cellClassName: "tabular-nums",
    header: "所要",
    key: "elapsed",
    renderCell: (job) => formatDuration(job.elapsedMilliseconds),
  },
  {
    cellClassName: "tabular-nums",
    header: "待機",
    key: "queue-wait",
    renderCell: (job) => formatDuration(job.queueWaitMilliseconds),
  },
  {
    cellClassName: "tabular-nums",
    header: "試行",
    key: "attempts",
    renderCell: (job) => `${job.attemptCount}回（再試行${job.transientRetryCount}回）`,
  },
  {
    header: "結果",
    key: "result",
    renderCell: (job) =>
      job.safeFailureCode ? failureLabel(job.safeFailureCode) : resultLabel(job.resultDisposition),
  },
] satisfies Array<DataTableColumn<RecentJob>>;
