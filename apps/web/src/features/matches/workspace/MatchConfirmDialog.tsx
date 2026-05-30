import { useFormStatus } from "react-dom";

import type { MatchFormValues } from "@/features/matches/workspace/matchFormTypes";
import type { HeldEventResponse } from "@/shared/api/heldEvents";
import { memberDisplayName } from "@/shared/domain/members";
import { Button } from "@/shared/ui/actions/Button";
import { Dialog } from "@/shared/ui/feedback/Dialog";

type MatchConfirmDialogProps = {
  gameTitleName?: string | undefined;
  heldEvent: HeldEventResponse | undefined;
  mapName?: string | undefined;
  seasonName?: string | undefined;
  validationMessage?: string | undefined;
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
      <Button disabled={pending} pending={pending} pendingLabel="確定中…" type="submit">
        確定する
      </Button>
    </div>
  );
}

export function MatchConfirmDialog({
  gameTitleName,
  heldEvent,
  mapName,
  seasonName,
  validationMessage,
  values,
  onCancel,
  confirmAction,
}: MatchConfirmDialogProps) {
  return (
    <Dialog
      open
      description="確定前の確認"
      title="この内容で確定しますか？"
      onOpenChange={(open) => {
        if (!open) {
          onCancel();
        }
      }}
    >
      <form action={confirmAction} className="min-w-0">
        <dl className="grid gap-2 text-sm text-[var(--color-text-primary)]">
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
                .map((player) => `${player.rank}位 ${memberDisplayName(player.memberId)}`)
                .join(" / ")}
            </dd>
          </div>
        </dl>

        {validationMessage ? (
          <div
            className="mt-4 rounded-[var(--radius-sm)] border border-[var(--color-warning)]/65 bg-[var(--color-warning)]/18 px-3 py-2 text-sm text-[var(--color-text-primary)]"
            role="alert"
          >
            {validationMessage}
          </div>
        ) : null}

        <ConfirmActionButtons onCancel={onCancel} />
      </form>
    </Dialog>
  );
}
