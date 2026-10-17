import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import { useSearchParams } from "react-router-dom";

import { defaultSetupValues } from "@/features/ocrCapture/schema";
import { SetupPanel } from "@/features/ocrCapture/SetupPanel";
import { useOcrSetup } from "@/features/ocrCapture/useOcrSetup";
import { trimSearchParam } from "@/shared/lib/searchParams";
import { Button } from "@/shared/ui/actions/Button";
import { Notice } from "@/shared/ui/feedback/Notice";
import { PendingStatus } from "@/shared/ui/feedback/PendingStatus";
import { contentText } from "@/shared/ui/typography";

type SetupOwner = ReturnType<typeof useOcrSetup>;
const SetupDisplay = createContext<{
  choices: { failed: boolean; refreshing: boolean; refresh: () => void };
  panel: SetupOwner["panel"];
} | null>(null);
const SetupSubmission = createContext<Pick<
  SetupOwner,
  "options" | "resolution" | "blockedReason"
> | null>(null);

/** Setup query and editing subscriptions are independent of image/transport updates. */
export function OcrCaptureSetupProvider({
  authReady,
  children,
}: {
  authReady: boolean;
  children: ReactNode;
}) {
  const [searchParams] = useSearchParams();
  const requestedHeldEventId = trimSearchParam(searchParams.get("heldEventId"));
  const setup = useOcrSetup({
    enabled: authReady,
    initialValue: {
      ...defaultSetupValues,
      ...(requestedHeldEventId ? { heldEventId: requestedHeldEventId } : {}),
    },
  });
  const submission = useMemo(
    () => ({
      options: setup.options,
      resolution: setup.resolution,
      blockedReason: setup.blockedReason,
    }),
    [setup.options, setup.resolution, setup.blockedReason],
  );
  const display = useMemo(
    () => ({
      panel: setup.panel,
      choices: {
        failed: setup.options.hasError,
        refreshing: setup.options.refreshing,
        refresh: setup.options.retry,
      },
    }),
    [setup.panel, setup.options.hasError, setup.options.refreshing, setup.options.retry],
  );
  return (
    <SetupDisplay value={display}>
      <SetupSubmission value={submission}>{children}</SetupSubmission>
    </SetupDisplay>
  );
}

export function useOcrCaptureSetupSubmission() {
  const setup = useContext(SetupSubmission);
  if (!setup) throw new Error("OCR setup is unavailable");
  return setup;
}

export function OcrCaptureSetupSection() {
  const setup = useContext(SetupDisplay);
  if (!setup) throw new Error("OCR setup is unavailable");
  return (
    <section className="grid min-w-0 gap-4" aria-labelledby="ocr-record-destination">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="ocr-record-destination" className={contentText.heading}>
          記録先
        </h2>
        <PendingStatus
          idleLabel="読み取り結果に引き継ぐ試合設定"
          pending={setup.choices.refreshing && !setup.choices.failed}
        >
          試合設定の選択肢を確認中
        </PendingStatus>
      </div>
      {setup.choices.failed ? (
        <Notice
          action={
            <Button
              pending={setup.choices.refreshing}
              pendingLabel="再読み込み中"
              size="sm"
              variant="secondary"
              onClick={setup.choices.refresh}
            >
              選択肢を再読み込み
            </Button>
          }
          tone="warning"
          title="試合設定の選択肢を読み込めません"
        >
          <p>読み込めなかった選択肢を再取得できます。</p>
        </Notice>
      ) : null}
      <SetupPanel model={setup.panel} />
    </section>
  );
}
