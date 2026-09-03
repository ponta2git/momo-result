import { Check } from "lucide-react";

import { slotDefinitions } from "@/features/ocrCapture/captureState";
import type { OcrStartDialogState, OcrSubmissionPlan } from "@/features/ocrCapture/useOcrStartFlow";
import { Button } from "@/shared/ui/actions/Button";
import { Dialog } from "@/shared/ui/feedback/Dialog";
import { Notice } from "@/shared/ui/feedback/Notice";
import { ProgressBar } from "@/shared/ui/feedback/ProgressBar";
import { SpinnerIcon } from "@/shared/ui/feedback/Spinner";

type OcrStartDialogProps = {
  onClose: () => void;
  onConfirm: () => Promise<void>;
  onViewMatches: () => void;
  state: OcrStartDialogState;
};

function SetupSummary({ plan }: { plan: OcrSubmissionPlan }) {
  const items = [
    ["開催", plan.setupSummary.heldEvent],
    ["試合番号", plan.setupSummary.matchNo],
    ["作品", plan.setupSummary.gameTitle],
    ["シーズン", plan.setupSummary.season],
    ["マップ", plan.setupSummary.map],
    ["オーナー", plan.setupSummary.owner],
  ];

  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-sm border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-3 text-sm sm:grid-cols-3">
      {items.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-xs font-semibold text-[var(--color-text-muted)]">{label}</dt>
          <dd
            className="mt-0.5 truncate font-semibold text-[var(--color-text-primary)]"
            title={value}
          >
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function resultDestinationLabel(plan: OcrSubmissionPlan): string {
  return plan.setup.heldEventId ? "開催詳細で確認" : "試合一覧で確認";
}

function TraySummary({ plan }: { plan: OcrSubmissionPlan }) {
  const selectedKinds = new Set(plan.slots.map((slot) => slot.kind));

  return (
    <ol aria-label="送信する分類" className="grid gap-2 sm:grid-cols-3">
      {slotDefinitions.map((definition) => {
        const selected = selectedKinds.has(definition.kind);
        return (
          <li
            key={definition.kind}
            className="flex items-center gap-2 rounded-sm border border-[var(--color-border)] px-3 py-2 text-sm"
          >
            <span
              aria-hidden="true"
              className={`flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-[var(--color-text-primary)] ${definition.accentClass}`}
            >
              {selected ? <Check className="size-4" /> : definition.stationLabel}
            </span>
            <span className="min-w-0">
              <span className="block font-semibold text-[var(--color-text-primary)]">
                {definition.label}
              </span>
              <span className="block text-xs text-[var(--color-text-muted)]">
                {selected ? "送信する" : "今回は送信しない"}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function ConfirmingContent({
  onClose,
  onConfirm,
  plan,
}: {
  onClose: () => void;
  onConfirm: () => Promise<void>;
  plan: OcrSubmissionPlan;
}) {
  const isPartial = plan.slots.length < slotDefinitions.length;

  return (
    <div className="grid gap-4">
      <SetupSummary plan={plan} />
      <TraySummary plan={plan} />
      {isPartial ? (
        <Notice tone="warning" title={`${plan.slots.length}件だけで開始します`}>
          <p>未配置の分類は読み取られません。あとから確認画面で手入力できます。</p>
        </Notice>
      ) : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onClose}>
          戻って確認
        </Button>
        <Button onClick={() => void onConfirm()}>{plan.slots.length}件で読み取りを開始</Button>
      </div>
    </div>
  );
}

function progressView(state: Extract<OcrStartDialogState, { status: "submitting" }>) {
  const { progress } = state;
  const total = progress?.total ?? state.plan.slots.length;
  if (!progress || progress.phase === "creating_draft") {
    return { kind: "preparing", label: "試合の記録を準備しています" } as const;
  }
  if (progress.phase === "finalizing") {
    return {
      kind: "determinate",
      label: "読み取りの受け付けを確認しています",
      value: progress.completed,
      total,
    } as const;
  }
  const slotLabel =
    slotDefinitions.find((definition) => definition.kind === progress.slotKind)?.label ?? "画像";
  return {
    kind: "determinate",
    label: `${progress.current}/${progress.total}件目・${slotLabel}を送信しています`,
    value: progress.current - 1,
    total,
  } as const;
}

export function OcrStartDialog({ onClose, onConfirm, onViewMatches, state }: OcrStartDialogProps) {
  if (state.status === "closed") return null;

  if (state.status === "submitting") {
    const progress = progressView(state);
    return (
      <Dialog
        busy
        open
        dismissible={false}
        description="すべての画像を受け付けるまで、この画面を開いたままお待ちください。"
        title="画像を送信しています"
      >
        <div className="grid gap-4">
          <div className="flex items-start gap-3 rounded-sm border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-3">
            <span
              aria-hidden="true"
              className="mt-0.5 flex size-5 shrink-0 text-[var(--color-action)]"
            >
              {progress.kind === "preparing" ? <SpinnerIcon size="lg" /> : null}
            </span>
            <div className="min-w-0">
              <p className="font-semibold text-[var(--color-text-primary)]">{progress.label}</p>
              <p className="mt-1 text-sm leading-6 text-[var(--color-text-secondary)]">
                誤送信を防ぐため、準備が終わるまで移動や再操作はできません。
              </p>
            </div>
          </div>
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

  if (state.status === "partial_result") {
    return (
      <Dialog
        open
        dismissible={false}
        description="開始できた画像は処理中です。重複送信を避けるため、試合一覧で状態を確認してください。"
        title="一部の読み取りを開始しました"
      >
        <div className="grid gap-4">
          <Notice
            tone="warning"
            title={`${state.createdJobCount}件を開始・${state.failedJobCount}件は未開始`}
          >
            <p>未開始の分類は、読み取り完了後の確認画面で手入力できます。</p>
          </Notice>
          <div className="flex justify-end">
            <Button onClick={onViewMatches}>{resultDestinationLabel(state.plan)}</Button>
          </div>
        </div>
      </Dialog>
    );
  }

  if (state.status === "handoff_required") {
    return (
      <Dialog
        open
        dismissible={false}
        description="重複操作を避け、作成された記録の状態を確認してください。"
        title="試合一覧で状態を確認してください"
      >
        <div className="grid gap-4">
          <Notice tone="warning" title="後処理を完了できませんでした">
            <p>{state.message}</p>
          </Notice>
          <div className="flex justify-end">
            <Button onClick={onViewMatches}>{resultDestinationLabel(state.plan)}</Button>
          </div>
        </div>
      </Dialog>
    );
  }

  if (state.status === "recoverable_failure") {
    return (
      <Dialog
        open
        description="画像はこの画面に残っています。内容を確認するか、同じ内容でもう一度試せます。"
        title="読み取りを開始できませんでした"
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <div className="grid gap-4">
          <Notice tone="danger" title="送信を完了できませんでした">
            <p>{state.message}</p>
          </Notice>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={onClose}>
              閉じて画像を確認
            </Button>
            <Button onClick={() => void onConfirm()}>もう一度試す</Button>
          </div>
        </div>
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
    >
      <ConfirmingContent plan={state.plan} onClose={onClose} onConfirm={onConfirm} />
    </Dialog>
  );
}
