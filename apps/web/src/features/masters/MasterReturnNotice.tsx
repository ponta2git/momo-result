import { Link } from "react-router-dom";

import { Button } from "@/shared/ui/actions/Button";
import { Notice } from "@/shared/ui/feedback/Notice";

type HandoffStatus = "available" | "expired" | "invalid" | "missing";

type MasterReturnNoticeProps = {
  destination: string;
  disabled?: boolean;
  handoffStatus: HandoffStatus;
  onReturn: () => void;
};

export function MasterReturnNotice({
  destination,
  disabled = false,
  handoffStatus,
  onReturn,
}: MasterReturnNoticeProps) {
  const shouldWarn = handoffStatus === "expired" || handoffStatus === "invalid";

  return (
    <Notice
      tone={shouldWarn ? "warning" : "info"}
      title="不足していたマスタを追加したら、元の入力画面へ戻れます。"
      action={
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={onReturn} disabled={disabled}>
            元の入力画面へ戻る
          </Button>
          <Link
            className="text-sm text-[var(--color-text-secondary)] underline hover:text-[var(--color-text-primary)]"
            to={destination}
          >
            戻り先を確認
          </Link>
        </div>
      }
    >
      {shouldWarn ? (
        <p>handoff情報が無効または期限切れです。入力内容を復元できない可能性があります。</p>
      ) : (
        <p>現在の作業を中断せずに戻れるよう、戻り先情報を引き継いでいます。</p>
      )}
    </Notice>
  );
}
