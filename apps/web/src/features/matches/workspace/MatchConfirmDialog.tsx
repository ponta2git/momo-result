import type { HeldEventResponse } from "@/features/draftReview/api";
import type { MatchFormValues } from "@/features/matches/workspace/matchFormTypes";
import { fixedMembers } from "@/features/ocrCapture/localMasters";
import { Button } from "@/shared/ui/actions/Button";

function memberName(memberId: string): string {
  return fixedMembers.find((member) => member.memberId === memberId)?.displayName ?? memberId;
}

type MatchConfirmDialogProps = {
  heldEvent: HeldEventResponse | undefined;
  pending: boolean;
  values: MatchFormValues;
  onCancel: () => void;
  onConfirm: () => void;
};

export function MatchConfirmDialog({
  heldEvent,
  pending,
  values,
  onCancel,
  onConfirm,
}: MatchConfirmDialogProps) {
  return (
    <div className="fixed inset-0 z-[var(--z-dialog)] grid place-items-center bg-[var(--momo-night-900)]/35 p-4">
      <div className="w-full max-w-xl rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-lg">
        <p className="text-xs font-semibold text-[var(--color-text-secondary)]">Final Check</p>
        <h2 className="mt-2 text-2xl font-semibold text-balance text-[var(--color-text-primary)]">
          この内容で確定しますか？
        </h2>

        <dl className="mt-5 grid gap-2 text-sm text-[var(--color-text-primary)]">
          <div className="flex justify-between gap-4">
            <dt className="text-[var(--color-text-secondary)]">開催履歴</dt>
            <dd>{heldEvent ? new Date(heldEvent.heldAt).toLocaleString() : values.heldEventId}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-[var(--color-text-secondary)]">試合番号</dt>
            <dd>第{values.matchNoInEvent}試合</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-[var(--color-text-secondary)]">作品 / マップ</dt>
            <dd>
              {values.gameTitleId} / {values.mapMasterId}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-[var(--color-text-secondary)]">順位</dt>
            <dd>
              {values.players
                .map((player) => `${player.rank}位 ${memberName(player.memberId)}`)
                .join(" / ")}
            </dd>
          </div>
        </dl>

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" disabled={pending} onClick={onCancel}>
            戻って修正
          </Button>
          <Button disabled={pending} onClick={onConfirm}>
            確定する
          </Button>
        </div>
      </div>
    </div>
  );
}
