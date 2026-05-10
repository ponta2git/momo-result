import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Download, ListFilter, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { createHeldEvent, deleteHeldEvent, listHeldEvents } from "@/shared/api/heldEvents";
import type { HeldEventListResponse, HeldEventResponse } from "@/shared/api/heldEvents";
import { formatApiError } from "@/shared/api/problemDetails";
import { isInitialQueryLoading, shouldShowBlockingQueryError } from "@/shared/api/queryErrorState";
import { heldEventKeys } from "@/shared/api/queryKeys";
import { Button } from "@/shared/ui/actions/Button";
import { DataTable } from "@/shared/ui/data/DataTable";
import type { DataTableColumn } from "@/shared/ui/data/DataTable";
import { EmptyState } from "@/shared/ui/feedback/EmptyState";
import { LiveRegion } from "@/shared/ui/feedback/LiveRegion";
import { Notice } from "@/shared/ui/feedback/Notice";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";
import { TextField } from "@/shared/ui/forms/TextField";
import { Card } from "@/shared/ui/layout/Card";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import { PageHeader } from "@/shared/ui/layout/PageHeader";

const emptyHeldEvents: HeldEventResponse[] = [];

function currentLocalIsoMinute(): string {
  const now = new Date();
  const offsetMs = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 16);
}

function toIsoFromLocal(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toISOString();
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

function formatDateKey(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function upsertHeldEventList(
  current: HeldEventListResponse | undefined,
  event: HeldEventResponse,
): HeldEventListResponse {
  const existingItems = current?.items ?? [];
  const withoutDuplicate = existingItems.filter((item) => item.id !== event.id);
  return {
    items: [event, ...withoutDuplicate].toSorted(
      (left, right) =>
        new Date(right.heldAt).getTime() - new Date(left.heldAt).getTime() ||
        right.id.localeCompare(left.id),
    ),
  };
}

function removeHeldEventFromList(
  current: HeldEventListResponse | undefined,
  heldEventId: string,
): HeldEventListResponse {
  return {
    items: (current?.items ?? []).filter((item) => item.id !== heldEventId),
  };
}

export function HeldEventsPage() {
  const queryClient = useQueryClient();
  const [heldAtDraft, setHeldAtDraft] = useState(currentLocalIsoMinute);
  const [notice, setNotice] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<HeldEventResponse | null>(null);

  const heldEventsQuery = useQuery({
    queryFn: () => listHeldEvents("", 100),
    queryKey: heldEventKeys.scope("held-events-page"),
  });

  const createMutation = useMutation({
    mutationFn: () => createHeldEvent({ heldAt: toIsoFromLocal(heldAtDraft) }),
    onSuccess: (event) => {
      queryClient.setQueryData<HeldEventListResponse>(
        heldEventKeys.scope("held-events-page"),
        (current) => upsertHeldEventList(current, event),
      );
      void queryClient.invalidateQueries({ queryKey: heldEventKeys.all() });
      setHeldAtDraft(currentLocalIsoMinute());
      setErrorMessage("");
      setNotice(`開催履歴（${formatDateTime(event.heldAt)}）を作成しました。`);
    },
    onError: (error) => {
      setNotice("");
      setErrorMessage(formatApiError(error, "開催履歴の作成に失敗しました"));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (event: HeldEventResponse) => deleteHeldEvent(event.id),
    onSuccess: (response) => {
      queryClient.setQueryData<HeldEventListResponse>(
        heldEventKeys.scope("held-events-page"),
        (current) => removeHeldEventFromList(current, response.heldEventId),
      );
      void queryClient.invalidateQueries({ queryKey: heldEventKeys.all() });
      setDeleteTarget(null);
      setErrorMessage("");
      setNotice("開催履歴を削除しました。");
    },
    onError: (error) => {
      setNotice("");
      setDeleteTarget(null);
      setErrorMessage(formatApiError(error, "開催履歴の削除に失敗しました"));
    },
  });

  const rows = heldEventsQuery.data?.items ?? emptyHeldEvents;
  const totalMatches = useMemo(
    () => rows.reduce((sum, event) => sum + event.matchCount, 0),
    [rows],
  );

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
        header: "ID",
        key: "id",
        minWidth: "13rem",
        renderCell: (event) => (
          <code className="rounded-[var(--radius-xs)] bg-[var(--color-surface-subtle)] px-1.5 py-0.5 text-xs break-all">
            {event.id}
          </code>
        ),
      },
      {
        align: "right",
        header: "操作",
        key: "actions",
        minWidth: "21rem",
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
            <Button
              disabled={event.matchCount > 0 || deleteMutation.isPending}
              icon={<Trash2 className="size-4" />}
              size="sm"
              variant="danger"
              onClick={() => setDeleteTarget(event)}
            >
              削除
            </Button>
          </div>
        ),
      },
    ],
    [deleteMutation.isPending],
  );

  const loading = isInitialQueryLoading(heldEventsQuery);
  const loadFailed = shouldShowBlockingQueryError(heldEventsQuery);
  const liveMessage = notice || errorMessage;

  return (
    <PageFrame className="gap-5">
      <LiveRegion message={liveMessage} />
      <PageHeader
        actions={
          <>
            <Link to="/matches">
              <Button variant="secondary">試合一覧へ</Button>
            </Link>
            <Button
              icon={<RefreshCw className="size-4" />}
              pending={heldEventsQuery.isFetching}
              pendingLabel="更新中..."
              variant="quiet"
              onClick={() => void heldEventsQuery.refetch()}
            >
              最新情報に更新
            </Button>
          </>
        }
        description="1夜の開催回を作成し、試合記録やCSV/TSV出力の範囲として使います。"
        eyebrow="Held Events"
        meta={
          <div className="grid gap-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm">
            <span className="text-xs font-semibold text-[var(--color-text-secondary)]">
              登録済み
            </span>
            <span className="text-[var(--color-text-primary)] tabular-nums">
              {rows.length.toLocaleString()}開催 / {totalMatches.toLocaleString()}試合
            </span>
          </div>
        }
        title="開催履歴"
      />

      {notice ? (
        <Notice tone="success" title="操作が完了しました">
          {notice}
        </Notice>
      ) : null}
      {errorMessage ? (
        <Notice tone="danger" title="操作に失敗しました">
          {errorMessage}
        </Notice>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(20rem,25rem)_minmax(0,1fr)] lg:items-start">
        <Card className="grid gap-4">
          <div className="grid gap-1">
            <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">新しい開催回</h2>
            <p className="text-sm leading-6 text-[var(--color-text-secondary)]">
              作成した開催回は、試合作成画面や出力範囲の候補にすぐ反映されます。
            </p>
          </div>
          <TextField
            label="開催日時"
            type="datetime-local"
            value={heldAtDraft}
            onChange={(event) => {
              setHeldAtDraft(event.target.value);
            }}
          />
          <Button
            disabled={!heldAtDraft || createMutation.isPending}
            icon={<Plus className="size-4" />}
            pending={createMutation.isPending}
            pendingLabel="作成中..."
            onClick={() => createMutation.mutate()}
          >
            開催履歴を作成
          </Button>
        </Card>

        <Card className="min-w-0">
          <div className="mb-3 flex min-w-0 flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">開催回一覧</h2>
              <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                試合がない開催回だけ削除できます。
              </p>
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
      </div>

      {deleteTarget ? (
        <DeleteHeldEventDialog
          event={deleteTarget}
          pending={deleteMutation.isPending}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => deleteMutation.mutate(deleteTarget)}
        />
      ) : null}
    </PageFrame>
  );
}

function DeleteHeldEventDialog({
  event,
  onCancel,
  onConfirm,
  pending,
}: {
  event: HeldEventResponse;
  onCancel: () => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  return (
    <div
      aria-labelledby="delete-held-event-title"
      aria-modal="true"
      className="fixed inset-0 z-[var(--z-dialog)] flex items-center justify-center bg-[var(--momo-night-900)]/60 px-4"
      role="dialog"
    >
      <Card className="w-full max-w-md">
        <h2
          className="text-lg font-semibold text-[var(--color-text-primary)]"
          id="delete-held-event-title"
        >
          開催履歴を削除しますか？
        </h2>
        <p className="mt-2 text-sm text-pretty text-[var(--color-text-secondary)]">
          {formatDateTime(event.heldAt)} の開催履歴を削除します。この操作は取り消せません。
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button disabled={pending} variant="secondary" onClick={onCancel}>
            キャンセル
          </Button>
          <Button disabled={pending} variant="danger" onClick={onConfirm}>
            {pending ? "削除中..." : "削除する"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
