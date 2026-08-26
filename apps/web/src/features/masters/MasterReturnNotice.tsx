import { Button } from "@/shared/ui/actions/Button";
import { Notice } from "@/shared/ui/feedback/Notice";

type HandoffStatus = "available" | "expired" | "invalid" | "missing";

type MasterReturnNoticeProps = {
  disabled?: boolean;
  disabledReason?: string | undefined;
  handoffStatus: HandoffStatus;
  onReturn: () => void;
  pending?: boolean;
};

export function MasterReturnNotice({
  disabled = false,
  disabledReason,
  handoffStatus,
  onReturn,
  pending = false,
}: MasterReturnNoticeProps) {
  const preservesInput = handoffStatus === "available";

  return (
    <Notice
      tone={preservesInput ? "info" : "warning"}
      title={preservesInput ? "元の入力画面へ戻れます" : "戻る前に入力内容を確認してください"}
      action={
        <div className="grid justify-items-start gap-1">
          <Button
            variant="primary"
            pending={pending}
            pendingLabel="移動中…"
            onClick={onReturn}
            disabled={disabled}
          >
            元の入力画面へ戻る
          </Button>
          {disabledReason ? (
            <p className="text-xs text-[var(--color-text-secondary)]">{disabledReason}</p>
          ) : null}
        </div>
      }
    >
      {preservesInput ? (
        <p>現在の入力内容を保ったまま戻れます。</p>
      ) : (
        <p>戻り先の情報を確認できません。入力内容を復元できない可能性があります。</p>
      )}
    </Notice>
  );
}
