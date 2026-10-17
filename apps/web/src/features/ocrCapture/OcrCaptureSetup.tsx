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
  options: Pick<SetupOwner["options"], "hasError" | "refreshing" | "retry">;
  panel: SetupOwner["panel"];
} | null>(null);
const SetupSubmission = createContext<
  | (Pick<SetupOwner, "resolution" | "blockedReason"> & {
      options: Pick<
        SetupOwner["options"],
        "mapMasters" | "seasonMasters" | "selectedGameTitle" | "selectedHeldEvent"
      >;
      refreshing: boolean;
    })
  | null
>(null);

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
  const { blockedReason, resolution } = setup;
  const { mapMasters, seasonMasters, selectedGameTitle, selectedHeldEvent, refreshing } =
    setup.options;
  const submission = useMemo(
    () => ({
      options: { mapMasters, seasonMasters, selectedGameTitle, selectedHeldEvent },
      resolution,
      blockedReason,
      refreshing,
    }),
    [
      mapMasters,
      seasonMasters,
      selectedGameTitle,
      selectedHeldEvent,
      resolution,
      blockedReason,
      refreshing,
    ],
  );
  return (
    <SetupDisplay value={setup}>
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
          pending={setup.options.refreshing && !setup.options.hasError}
        >
          試合設定の選択肢を確認中
        </PendingStatus>
      </div>
      {setup.options.hasError ? (
        <Notice
          action={
            <Button
              pending={setup.options.refreshing}
              pendingLabel="再読み込み中"
              size="sm"
              variant="secondary"
              onClick={setup.options.retry}
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
