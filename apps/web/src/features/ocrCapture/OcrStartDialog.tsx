import { Check } from "lucide-react";
import { memo } from "react";

import { slotDefinitions } from "@/features/ocrCapture/captureState";
import type { OcrStartDialogView, OcrStartSummary } from "@/features/ocrCapture/ocrStartState";
import { Button } from "@/shared/ui/actions/Button";
import { FactList } from "@/shared/ui/data/FactList";
import { Dialog, DialogFooter } from "@/shared/ui/feedback/Dialog";
import { Notice } from "@/shared/ui/feedback/Notice";
import { ProgressBar } from "@/shared/ui/feedback/ProgressBar";
import { SpinnerIcon } from "@/shared/ui/feedback/Spinner";
import { contentText } from "@/shared/ui/typography";

type OcrStartDialogProps = {
  navigationPending?: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  onViewMatches: () => void;
  view: OcrStartDialogView;
};

function SetupSummary({ summary }: { summary: OcrStartSummary }) {
  const items = [
    ["開催", summary.setup.heldEvent],
    ["試合番号", summary.setup.matchNo],
    ["作品", summary.setup.gameTitle],
    ["シーズン", summary.setup.season],
    ["マップ", summary.setup.map],
    ["オーナー", summary.setup.owner],
  ] as const;

  return (
    <FactList
      ariaLabel="読み取る試合の設定"
      columns={3}
      items={items.map(([label, value]) => ({ id: label, label, value }))}
      layout="plain"
    />
  );
}

function TraySummary({ summary }: { summary: OcrStartSummary }) {
  const selectedKinds = new Set(summary.selectedKinds);

  return (
    <ol aria-label="送信する分類" className="grid gap-4 sm:grid-cols-3">
      {slotDefinitions.map((definition) => {
        const selected = selectedKinds.has(definition.kind);
        return (
          <li
            key={definition.kind}
            className="flex items-center gap-2 rounded-sm border border-[var(--color-border)] p-3"
          >
            <span
              aria-hidden="true"
              className={`font-plain flex size-7 shrink-0 items-center justify-center rounded-xs text-xs text-[var(--color-text-primary)] ${definition.accentClass}`}
            >
              {selected ? <Check className="size-4" /> : definition.stationLabel}
            </span>
            <span className="grid min-w-0 gap-0.5">
              <span className={contentText.body}>{definition.label}</span>
              <span className={contentText.supporting}>
                {selected ? "送信する" : "今回は送信しない"}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Settings, send targets, and the caution answer different questions, so they stay apart. */
function ConfirmingContent({ summary }: { summary: OcrStartSummary }) {
  const isPartial = summary.selectedKinds.length < slotDefinitions.length;

  return (
    <div className="grid gap-6">
      <SetupSummary summary={summary} />
      <TraySummary summary={summary} />
      {isPartial ? (
        <Notice tone="warning" title={`${summary.selectedKinds.length}件だけで開始します`}>
          <p>未配置の分類は読み取られません。あとから確認画面で手入力できます。</p>
        </Notice>
      ) : null}
    </div>
  );
}

export const OcrStartDialog = memo(function OcrStartDialog({
  navigationPending = false,
  onClose,
  onConfirm,
  onViewMatches,
  view,
}: OcrStartDialogProps) {
  if (view.status === "closed") return null;

  if (view.status === "submitting") {
    const progress = view.progress;
    return (
      <Dialog
        busy
        open
        dismissible={false}
        description="すべての画像を受け付けるまで、この画面を開いたままお待ちください。"
        title="画像を送信しています"
      >
        <div className="grid gap-4">
          {/* The dialog already reports busy; the label changes are not announced again. */}
          <Notice
            role="note"
            title={
              <span className="inline-flex items-center gap-2">
                {progress.kind === "preparing" ? <SpinnerIcon /> : null}
                {progress.label}
              </span>
            }
          >
            誤送信を防ぐため、準備が終わるまで移動や再操作はできません。
          </Notice>
          {progress.kind === "determinate" ? (
            <ProgressBar
              aria-label="画像送信の進捗"
              aria-valuetext={`${progress.total}件中${progress.value}件の送信処理が完了`}
              max={progress.total}
              value={progress.value}
            />
          ) : null}
        </div>
      </Dialog>
    );
  }

  if (view.status === "partial_result") {
    return (
      <Dialog
        open
        dismissible={false}
        description="受け付け済みの画像は保持されています。残りを再試行するか、記録を確認できます。"
        title="一部の読み取りを開始しました"
        footer={
          <DialogFooter>
            <Button
              variant="secondary"
              pending={navigationPending}
              pendingLabel="移動中…"
              onClick={onViewMatches}
            >
              {view.destinationLabel}
            </Button>
            <Button onClick={() => void onConfirm()}>残りをもう一度試す</Button>
          </DialogFooter>
        }
      >
        <Notice
          tone="warning"
          title={`${view.createdJobCount}件を開始・${view.failedJobCount}件は受付未確認`}
        >
          <p>
            同じ内容で再試行すると、受け付け済みの画像を再送せずに続けられます。確認画面で手入力することもできます。
          </p>
        </Notice>
      </Dialog>
    );
  }

  if (view.status === "submission_closed") {
    return (
      <Dialog
        open
        dismissible={false}
        title="この送信の受付は終了しました"
        description="受け付け済みの読み取りは記録から確認できます。"
        footer={
          <DialogFooter>
            <Button
              variant="secondary"
              pending={navigationPending}
              pendingLabel="移動中…"
              onClick={onViewMatches}
            >
              {view.destinationLabel}
            </Button>
            {view.canRestart ? (
              <Button onClick={() => void onConfirm()}>未受付の画像を新しく送信</Button>
            ) : null}
          </DialogFooter>
        }
      >
        <p className={contentText.body}>
          {view.canRestart
            ? "未受付の画像は、新しい読み取りとして送信できます。完了通知も別になります。"
            : "この記録への送信は続けられません。記録の状態を確認してください。"}
        </p>
      </Dialog>
    );
  }

  if (view.status === "recoverable_failure") {
    return (
      <Dialog
        open
        dismissible={view.canEdit}
        onOpenChange={(open) => {
          if (!open && view.canEdit) onClose();
        }}
        description={
          view.canEdit
            ? "読み取りは開始されていません。画像を保持したまま、設定を確認してやり直せます。"
            : "画像と受付状況は保持されています。同じ内容で再試行するか、作成された記録を確認できます。"
        }
        title={
          view.canEdit ? "読み取りを開始できませんでした" : "読み取りの受付を確認できませんでした"
        }
        footer={
          <DialogFooter>
            {view.canEdit ? (
              <Button variant="secondary" onClick={onClose}>
                戻って確認
              </Button>
            ) : (
              <Button
                variant="secondary"
                pending={navigationPending}
                pendingLabel="移動中…"
                onClick={onViewMatches}
              >
                {view.destinationLabel}
              </Button>
            )}
            <Button onClick={() => void onConfirm()}>もう一度試す</Button>
          </DialogFooter>
        }
      >
        <Notice tone="danger" title="送信を完了できませんでした">
          <p>{view.message}</p>
        </Notice>
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      description="試合設定と送信する分類を確認してください。開始後は、受付が終わるまで操作できません。"
      title="読み取りを開始しますか？"
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      footer={
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            戻って確認
          </Button>
          <Button onClick={() => void onConfirm()}>
            {view.summary.selectedKinds.length}件で読み取りを開始
          </Button>
        </DialogFooter>
      }
    >
      <ConfirmingContent summary={view.summary} />
    </Dialog>
  );
});
