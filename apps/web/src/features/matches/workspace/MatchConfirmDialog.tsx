import { AlertTriangle, Check } from "lucide-react";
import { useFormStatus } from "react-dom";

import type { MatchFormValues } from "@/features/matches/workspace/matchFormTypes";
import type { HeldEventResponse } from "@/shared/api/heldEvents";
import { formatMatchNoInEvent } from "@/shared/domain/matchLabels";
import { memberDisplayName, orderFixedMembers } from "@/shared/domain/members";
import { formatDateTimeLong } from "@/shared/lib/dateTime";
import { Button } from "@/shared/ui/actions/Button";
import { FactList } from "@/shared/ui/data/FactList";
import { Dialog, dialogFooterClassName } from "@/shared/ui/feedback/Dialog";
import { RankBadge } from "@/shared/ui/rank/RankBadge";

type MatchConfirmDialogProps = {
  actions: MatchConfirmActions;
  pending?: boolean | undefined;
  reviewSummary: MatchConfirmReviewSummary;
  summary: MatchConfirmSummaryProps;
  validationMessage?: string | undefined;
  values: MatchFormValues;
};

type MatchConfirmActions = {
  confirmAction: (formData: FormData) => void | Promise<void>;
  onCancel: () => void;
};

type MatchConfirmSummaryProps = {
  gameTitleName?: string | undefined;
  heldEvent: HeldEventResponse | undefined;
  mapName?: string | undefined;
  seasonName?: string | undefined;
};

type MatchConfirmReviewSummary = {
  changedCount: number;
  totalCount: number;
  unresolvedCount: number;
};

function ConfirmActionButtons({ onCancel }: { onCancel: () => void }) {
  const { pending } = useFormStatus();
  return (
    <div className={`mt-6 ${dialogFooterClassName}`}>
      <Button variant="secondary" disabled={pending} onClick={onCancel} type="button">
        戻って修正
      </Button>
      <Button disabled={pending} pendingLabel="確定中…" type="submit">
        確定する
      </Button>
    </div>
  );
}

function MatchConfirmSummary({
  gameTitleName,
  heldEvent,
  mapName,
  seasonName,
  values,
}: MatchConfirmSummaryProps & { values: MatchFormValues }) {
  return (
    <FactList
      ariaLabel="確定する試合の開催条件"
      items={[
        {
          id: "held-event",
          label: "開催履歴",
          value: heldEvent ? formatDateTimeLong(heldEvent.heldAt) : "未選択",
        },
        {
          id: "match-no",
          label: "試合番号",
          value: formatMatchNoInEvent(values.matchNoInEvent),
        },
        { id: "game-title", label: "作品", value: gameTitleName ?? "未選択" },
        { id: "season", label: "シーズン", value: seasonName ?? "未選択" },
        { id: "map", label: "マップ", value: mapName ?? "未選択" },
      ]}
      layout="inline"
    />
  );
}

function PlayerLedger({ values }: { values: MatchFormValues }) {
  const orderedPlayers = orderFixedMembers(values.players);
  return (
    <div className="mt-4 overflow-x-auto rounded-[var(--radius-sm)] border border-[var(--color-border)]">
      <table className="w-full min-w-[29rem] text-left text-sm">
        <caption className="sr-only">確定する4人分の結果</caption>
        <thead className="bg-[var(--color-surface-subtle)] text-xs text-[var(--color-text-secondary)]">
          <tr>
            <th className="px-3 py-2 font-medium">順位</th>
            <th className="px-3 py-2 font-medium">メンバー</th>
            <th className="px-3 py-2 text-right font-medium">総資産（万円）</th>
            <th className="px-3 py-2 text-right font-medium">収益（万円）</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-border)]">
          {orderedPlayers.map((player) => (
            <tr key={player.memberId}>
              <td className="px-3 py-2">
                <RankBadge rank={player.rank} />
              </td>
              <td className="px-3 py-2">{memberDisplayName(player.memberId)}</td>
              <td className="px-3 py-2 text-right tabular-nums">
                {player.totalAssetsManYen.toLocaleString()}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {player.revenueManYen.toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OcrReviewSummary({
  changedCount,
  totalCount,
  unresolvedCount,
}: MatchConfirmReviewSummary) {
  if (totalCount === 0 && changedCount === 0) {
    return null;
  }
  const reviewedCount = totalCount - unresolvedCount;
  return (
    <div className="mt-4 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm tabular-nums">
        <span className="font-semibold text-[var(--color-text-primary)]">OCR確認状況</span>
        <span className="text-[var(--color-text-secondary)]">修正 {changedCount}件</span>
        <span className="text-[var(--color-text-secondary)]">
          確認済み {reviewedCount} / {totalCount}
        </span>
      </div>
      {unresolvedCount > 0 ? (
        <p className="mt-2 flex gap-2 text-sm leading-5 text-[var(--color-text-primary)]">
          <AlertTriangle
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-[var(--color-warning)]"
          />
          <span>
            未確認の強調項目が{unresolvedCount}
            件あります。このまま確定できますが、元画像との照合を推奨します。
          </span>
        </p>
      ) : (
        <p className="mt-2 flex items-center gap-2 text-sm text-[var(--color-success)]">
          <Check aria-hidden="true" className="size-4" />
          強調された項目はすべて確認済みです
        </p>
      )}
    </div>
  );
}

export function MatchConfirmDialog({
  actions,
  pending = false,
  reviewSummary,
  summary,
  validationMessage,
  values,
}: MatchConfirmDialogProps) {
  return (
    <Dialog
      busy={pending}
      open
      description="確定前の確認"
      title="この内容で確定しますか？"
      onOpenChange={(open) => {
        if (!open) {
          actions.onCancel();
        }
      }}
    >
      <form action={actions.confirmAction} className="min-w-0">
        <MatchConfirmSummary {...summary} values={values} />
        <PlayerLedger values={values} />
        <OcrReviewSummary {...reviewSummary} />

        {validationMessage ? (
          <div
            className="mt-4 rounded-[var(--radius-sm)] border border-[var(--color-warning)]/65 bg-[var(--color-warning)]/18 px-3 py-2 text-sm text-[var(--color-text-primary)]"
            role="alert"
          >
            {validationMessage}
          </div>
        ) : null}

        <ConfirmActionButtons onCancel={actions.onCancel} />
      </form>
    </Dialog>
  );
}
