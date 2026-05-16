import {
  CalendarDays,
  Download,
  ListFilter,
  PenSquare,
  Plus,
  RefreshCw,
  ScanLine,
  Trash2,
} from "lucide-react";
import { useMemo } from "react";
import { useFormStatus } from "react-dom";
import { Link } from "react-router-dom";

import { formatDateKey, formatDateTime } from "@/features/heldEvents/heldEventViewModel";
import { useHeldEventsPageController } from "@/features/heldEvents/useHeldEventsPageController";
import type { HeldEventResponse } from "@/shared/api/heldEvents";
import { Button } from "@/shared/ui/actions/Button";
import { DataTable } from "@/shared/ui/data/DataTable";
import type { DataTableColumn } from "@/shared/ui/data/DataTable";
import { AlertDialog } from "@/shared/ui/feedback/Dialog";
import { EmptyState } from "@/shared/ui/feedback/EmptyState";
import { LiveRegion } from "@/shared/ui/feedback/LiveRegion";
import { Notice } from "@/shared/ui/feedback/Notice";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";
import { TextField } from "@/shared/ui/forms/TextField";
import { Card } from "@/shared/ui/layout/Card";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import { PageHeader } from "@/shared/ui/layout/PageHeader";

export function HeldEventsPage() {
  const controller = useHeldEventsPageController();
  const {
    createAction,
    createState,
    deleteMutation,
    deleteTarget,
    errorMessage,
    heldAtDraft,
    latestEvent,
    liveMessage,
    loadFailed,
    loading,
    refresh,
    refreshing,
    rows,
    setDeleteTarget,
    setHeldAtDraft,
    totalMatches,
  } = controller;

  const columns = useMemo<Array<DataTableColumn<HeldEventResponse>>>(
    () => [
      {
        header: "開催日時",
        key: "heldAt",
        minWidth: "14rem",
        renderCell: (event) => (
          <div className="grid gap-1">
            <span className="font-semibold">{formatDateTime(event.heldAt)}</span>
            <span className="text-xs text-[var(--color-text-secondary)]">
              {formatDateKey(event.heldAt)}
            </span>
          </div>
        ),
      },
      {
        align: "right",
        header: "試合数",
        key: "matchCount",
        minWidth: "7rem",
        renderCell: (event) => (
          <span className="tabular-nums">{event.matchCount.toLocaleString()}試合</span>
        ),
      },
      {
        align: "right",
        header: "操作",
        key: "actions",
        minWidth: "17rem",
        renderCell: (event) => (
          <div className="flex min-w-0 flex-wrap justify-end gap-2">
            <Link to={`/matches?heldEventId=${encodeURIComponent(event.id)}`}>
              <Button icon={<ListFilter className="size-4" />} size="sm" variant="secondary">
                試合
              </Button>
            </Link>
            <Link to={`/exports?heldEventId=${encodeURIComponent(event.id)}&format=csv`}>
              <Button icon={<Download className="size-4" />} size="sm" variant="secondary">
                出力
              </Button>
            </Link>
            {event.matchCount === 0 ? (
              <Button
                disabled={deleteMutation.isPending}
                icon={<Trash2 className="size-4" />}
                size="sm"
                variant="quiet"
                onClick={() => setDeleteTarget(event)}
              >
                削除
              </Button>
            ) : (
              <span className="inline-flex min-h-9 items-center rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 py-1.5 text-sm font-semibold text-[var(--color-text-secondary)]">
                試合あり
              </span>
            )}
          </div>
        ),
      },
    ],
    [deleteMutation.isPending, setDeleteTarget],
  );

  return (
    <PageFrame className="gap-5">
      <LiveRegion message={liveMessage} />
      <PageHeader
        actions={
          <Button
            icon={<RefreshCw className="size-4" />}
            pending={refreshing}
            pendingLabel="更新中…"
            variant="quiet"
            onClick={refresh}
          >
            最新情報に更新
          </Button>
        }
        description="1夜の開催回を作成し、試合記録やCSV/TSV出力の範囲として使います。"
        eyebrow="開催"
        title="開催履歴"
      />

      {errorMessage ? (
        <Notice tone="danger" title="操作に失敗しました">
          {errorMessage}
        </Notice>
      ) : null}

      {latestEvent ? (
        <Card className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
          <div>
            <p className="text-xs font-semibold text-[var(--color-text-secondary)]">最新開催</p>
            <h2 className="mt-1 text-2xl font-semibold text-balance text-[var(--color-text-primary)]">
              {formatDateTime(latestEvent.heldAt)}
            </h2>
            <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
              現在 {latestEvent.matchCount.toLocaleString()}試合。次は第
              {(latestEvent.matchCount + 1).toLocaleString()}試合として記録します。
            </p>
          </div>
          <div className="flex flex-wrap gap-2 md:justify-end">
            <Link to="/ocr/new">
              <Button icon={<ScanLine className="size-4" />}>OCR取り込み</Button>
            </Link>
            <Link to="/matches/new">
              <Button icon={<PenSquare className="size-4" />} variant="secondary">
                手入力で作成
              </Button>
            </Link>
            <Link to={`/matches?heldEventId=${encodeURIComponent(latestEvent.id)}`}>
              <Button icon={<ListFilter className="size-4" />} variant="secondary">
                この開催の試合
              </Button>
            </Link>
          </div>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <Card className="min-w-0">
          <div className="mb-3 flex min-w-0 flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">開催回一覧</h2>
              <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                試合がない開催回だけ削除できます。
              </p>
            </div>
            <div className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 py-2 text-sm tabular-nums">
              {rows.length.toLocaleString()}開催 / {totalMatches.toLocaleString()}試合
            </div>
          </div>

          {loading ? (
            <div className="grid gap-3">
              <Skeleton className="min-h-10" />
              <Skeleton className="min-h-24" />
              <Skeleton className="min-h-24" />
            </div>
          ) : loadFailed ? (
            <Notice tone="danger" title="開催履歴を読み込めませんでした。">
              しばらくしてから再読み込みしてください。
            </Notice>
          ) : (
            <DataTable
              columns={columns}
              emptyState={
                <EmptyState
                  description="最初の試合を作る前に、この画面で開催回を作成してください。"
                  icon={<CalendarDays className="size-5" />}
                  title="開催履歴がまだありません"
                />
              }
              getRowKey={(event) => event.id}
              rows={rows}
            />
          )}
        </Card>

        <form key={createState.version} action={createAction}>
          <Card className="grid gap-4">
            <div className="grid gap-1">
              <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
                新しい開催回
              </h2>
              <p className="text-sm leading-6 text-[var(--color-text-secondary)]">
                summit側で作られない場合に、ここから開催回を追加します。
              </p>
            </div>
            <TextField
              label="開催日時"
              name="heldAt"
              type="datetime-local"
              value={heldAtDraft}
              onChange={(event) => {
                setHeldAtDraft(event.target.value);
              }}
            />
            <CreateHeldEventButton disabled={!heldAtDraft} />
          </Card>
        </form>
      </div>

      {deleteTarget ? (
        <AlertDialog
          cancelLabel="キャンセル"
          confirmLabel={deleteMutation.isPending ? "削除中…" : "削除する"}
          pending={deleteMutation.isPending}
          description={`${formatDateTime(deleteTarget.heldAt)} の開催履歴を削除します。この操作は取り消せません。`}
          open={Boolean(deleteTarget)}
          title="開催履歴を削除しますか？"
          trigger={
            <button className="sr-only" type="button">
              削除確認
            </button>
          }
          onConfirm={async () => {
            await deleteMutation.mutateAsync(deleteTarget);
          }}
          onOpenChange={(open) => {
            if (!open) setDeleteTarget(null);
          }}
        />
      ) : null}
    </PageFrame>
  );
}

function CreateHeldEventButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button
      disabled={disabled}
      icon={<Plus className="size-4" />}
      pending={pending}
      pendingLabel="作成中…"
      type="submit"
    >
      開催履歴を作成
    </Button>
  );
}
