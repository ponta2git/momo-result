import type { HeldEventResponse } from "@/features/draftReview/api";
import type { MatchFormValues } from "@/features/matches/workspace/matchFormTypes";
import { fixedMembers } from "@/features/ocrCapture/localMasters";
import { Button } from "@/shared/ui/Button";

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
    <div className="bg-capture-black/70 fixed inset-0 z-50 grid place-items-center p-4">
      <div className="border-line-soft bg-night-900 w-full max-w-xl rounded-3xl border p-6">
        <p className="text-rail-gold text-xs font-black tracking-[0.22em] uppercase">Final Check</p>
        <h2 className="text-ink-100 mt-2 text-2xl font-black">この内容で確定しますか？</h2>

        <dl className="text-ink-200 mt-5 grid gap-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-ink-400">開催履歴</dt>
            <dd>{heldEvent ? new Date(heldEvent.heldAt).toLocaleString() : values.heldEventId}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-400">試合番号</dt>
            <dd>第{values.matchNoInEvent}試合</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-400">作品 / マップ</dt>
            <dd>
              {values.gameTitleId} / {values.mapMasterId}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-400">順位</dt>
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
