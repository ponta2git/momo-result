import type { ReactNode } from "react";

import type {
  SeriesAnalysisAdminOverview,
  SeriesAnalysisJobStatus,
  SeriesAnalysisResultDisposition,
  SeriesAnalysisSafeFailureCode,
  SeriesAnalysisTrigger,
} from "@/shared/api/seriesAnalysis";
import { Notice } from "@/shared/ui/feedback/Notice";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";

export function ExecutionStatus({ data }: { data: SeriesAnalysisAdminOverview }) {
  const execution = data.globalExecution;
  return (
    <section
      aria-live="polite"
      className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]"
    >
      <header className="border-b border-[var(--color-border)] px-4 py-3">
        <h2 className="font-semibold">全体の実行状況</h2>
      </header>
      <dl className="grid divide-y divide-[var(--color-border)] text-sm sm:grid-cols-4 sm:divide-x sm:divide-y-0">
        <StatusDatum label="実行中" value={`${execution.runningCount}件`} />
        <StatusDatum label="待機作品" value={`${execution.queuedTitleCount}作品`} />
        <StatusDatum label="展開中キャンペーン" value={`${execution.activeCampaignCount}件`} />
        <StatusDatum label="最古の待機" value={formatDateTime(execution.oldestQueuedAt)} />
      </dl>
      {execution.latestActiveCampaign ? (
        <p className="border-t border-[var(--color-border)] px-4 py-3 text-xs text-[var(--color-text-secondary)]">
          全作品操作: 展開 {execution.latestActiveCampaign.expandedCount}/
          {execution.latestActiveCampaign.targetCount}・完了{" "}
          {execution.latestActiveCampaign.terminalCount}・失敗{" "}
          {execution.latestActiveCampaign.failedCount}・スキップ{" "}
          {execution.latestActiveCampaign.skippedCount}
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
    <section className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] px-4 py-3">
        <h2 className="font-semibold">{selected.gameTitleName}</h2>
        <StatusBadge status={status.calculation?.status ?? "not_run"} />
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
        <Notice className="m-3" tone="info" title="追加の再計算が予約されています">
          {selected.pendingManualRun.requestCount}件・最古{" "}
          {formatDateTime(selected.pendingManualRun.oldestRequestedAt)}
        </Notice>
      ) : null}
    </section>
  );
}

export function RecentJobs({ jobs }: { jobs: SeriesAnalysisAdminOverview["recentJobs"] }) {
  return (
    <section className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]">
      <header className="border-b border-[var(--color-border)] px-4 py-3">
        <h2 className="font-semibold">直近3件</h2>
        <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
          全作品を横断した新しい順です。履歴は45日保持します。
        </p>
      </header>
      {jobs.length === 0 ? (
        <p className="px-4 py-6 text-sm text-[var(--color-text-secondary)]">
          実行履歴はありません。
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[64rem] text-left text-sm">
            <thead>
              <tr>
                <TableHead>作品</TableHead>
                <TableHead>状態</TableHead>
                <TableHead>発火</TableHead>
                <TableHead>受理</TableHead>
                <TableHead>開始</TableHead>
                <TableHead>完了</TableHead>
                <TableHead>所要</TableHead>
                <TableHead>待機</TableHead>
                <TableHead>試行</TableHead>
                <TableHead>結果</TableHead>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr className="border-t border-[var(--color-border)]" key={job.jobId}>
                  <TableCell>
                    <strong>{job.gameTitleName}</strong>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={job.status} />
                  </TableCell>
                  <TableCell>{triggerLabel(job.trigger)}</TableCell>
                  <TableCell>{formatDateTime(job.requestedAt)}</TableCell>
                  <TableCell>{formatDateTime(job.startedAt)}</TableCell>
                  <TableCell>{formatDateTime(job.finishedAt)}</TableCell>
                  <TableCell>{formatDuration(job.elapsedMilliseconds)}</TableCell>
                  <TableCell>{formatDuration(job.queueWaitMilliseconds)}</TableCell>
                  <TableCell>
                    {job.attemptCount}回 / retry {job.transientRetryCount}
                  </TableCell>
                  <TableCell>
                    {job.safeFailureCode
                      ? failureLabel(job.safeFailureCode)
                      : resultLabel(job.resultDisposition)}
                  </TableCell>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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

function StatusBadge({ status }: { status: SeriesAnalysisJobStatus | "not_run" }) {
  return (
    <span className="inline-flex min-h-7 items-center rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-2 text-xs font-semibold">
      {statusLabel(status)}
    </span>
  );
}

function TableHead({ children }: { children: ReactNode }) {
  return (
    <th className="bg-[var(--color-surface-subtle)] px-3 py-2 font-semibold text-[var(--color-text-secondary)]">
      {children}
    </th>
  );
}

function TableCell({ children }: { children: ReactNode }) {
  return <td className="px-3 py-2 tabular-nums">{children}</td>;
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
  worker_crashed: "worker停止",
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
  timeStyle: "short",
});
const adminIntegerFormatter = new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 0 });

function formatDateTime(value: string | null | undefined): string {
  return value ? adminDateTimeFormatter.format(new Date(value)) : "—";
}

function formatInteger(value: number): string {
  return adminIntegerFormatter.format(value);
}
