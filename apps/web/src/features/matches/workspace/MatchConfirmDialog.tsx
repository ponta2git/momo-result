import { useFormStatus } from "react-dom";

import type { MatchFormValues } from "@/features/matches/workspace/matchFormTypes";
import type { HeldEventResponse } from "@/shared/api/heldEvents";
import { fixedMembers } from "@/shared/domain/members";
import { Button } from "@/shared/ui/actions/Button";

function memberName(memberId: string): string {
  return fixedMembers.find((member) => member.memberId === memberId)?.displayName ?? memberId;
}

type MatchConfirmDialogProps = {
  gameTitleName?: string | undefined;
  heldEvent: HeldEventResponse | undefined;
  mapName?: string | undefined;
  seasonName?: string | undefined;
  values: MatchFormValues;
  onCancel: () => void;
  confirmAction: (formData: FormData) => void | Promise<void>;
};

function ConfirmActionButtons({ onCancel }: { onCancel: () => void }) {
  const { pending } = useFormStatus();
  return (
    <div className="mt-6 flex justify-end gap-2">
      <Button variant="secondary" disabled={pending} onClick={onCancel} type="button">
        戻って修正
      </Button>
      <Button disabled={pending} type="submit">
        {pending ? "確定中…" : "確定する"}
      </Button>
    </div>
  );
}

export function MatchConfirmDialog({
  gameTitleName,
  heldEvent,
  mapName,
  seasonName,
  values,
  onCancel,
  confirmAction,
}: MatchConfirmDialogProps) {
  return (
    <div className="fixed inset-0 z-[var(--z-dialog)] grid place-items-center bg-[var(--momo-night-900)]/35 p-4">
      <form
        action={confirmAction}
        className="w-full max-w-xl rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-lg"
      >
        <p className="text-xs font-semibold text-[var(--color-text-secondary)]">確定前の確認</p>
        <h2 className="mt-2 text-2xl font-semibold text-balance text-[var(--color-text-primary)]">
          この内容で確定しますか？
        </h2>

        <dl className="mt-5 grid gap-2 text-sm text-[var(--color-text-primary)]">
          <div className="flex justify-between gap-4">
            <dt className="text-[var(--color-text-secondary)]">開催履歴</dt>
            <dd>{heldEvent ? new Date(heldEvent.heldAt).toLocaleString() : "未選択"}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-[var(--color-text-secondary)]">試合番号</dt>
            <dd>第{values.matchNoInEvent}試合</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-[var(--color-text-secondary)]">作品</dt>
            <dd>{gameTitleName ?? "未選択"}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-[var(--color-text-secondary)]">シーズン</dt>
            <dd>{seasonName ?? "未選択"}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-[var(--color-text-secondary)]">マップ</dt>
            <dd>{mapName ?? "未選択"}</dd>
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

        <ConfirmActionButtons onCancel={onCancel} />
      </form>
    </div>
  );
}
