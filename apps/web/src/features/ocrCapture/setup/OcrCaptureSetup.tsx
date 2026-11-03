import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import { useSearchParams } from "react-router-dom";

import { OcrSectionHeading } from "@/features/ocrCapture/OcrSectionHeading";
import { OcrSetupPanel } from "@/features/ocrCapture/setup/OcrSetupPanel";
import { defaultOcrSetupValues } from "@/features/ocrCapture/setup/ocrSetupSchema";
import { useOcrSetup } from "@/features/ocrCapture/setup/useOcrSetup";
import { trimSearchParam } from "@/shared/lib/searchParams";
import { recordExitHref } from "@/shared/navigation/matchLinks";
import { Button } from "@/shared/ui/actions/Button";
import { Notice } from "@/shared/ui/feedback/Notice";
import { PendingStatus } from "@/shared/ui/feedback/PendingStatus";

type OcrSetup = ReturnType<typeof useOcrSetup>;
const SetupDisplayContext = createContext<{
  options: Pick<OcrSetup["options"], "hasError" | "refreshing" | "retry">;
  panel: OcrSetup["panel"];
} | null>(null);
const SetupSubmissionContext = createContext<
  | (Pick<OcrSetup, "resolution" | "blockedReason"> & {
      options: Pick<
        OcrSetup["options"],
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
      ...defaultOcrSetupValues,
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
    <SetupDisplayContext value={setup}>
      <SetupSubmissionContext value={submission}>{children}</SetupSubmissionContext>
    </SetupDisplayContext>
  );
}

export function useOcrCaptureSetupSubmission() {
  const setup = useContext(SetupSubmissionContext);
  if (!setup) throw new Error("OCR setup is unavailable");
  return setup;
}

/** Leaving a capture returns to the held event it records into, like leaving a manual entry. */
export function useOcrCaptureExitHref(): string {
  const setup = useContext(SetupDisplayContext);
  if (!setup) throw new Error("OCR setup is unavailable");
  const { selectedHeldEvent, value } = setup.panel.fields.heldEvent;
  return recordExitHref(value || undefined, selectedHeldEvent?.publicId);
}

export function OcrCaptureSetupSection() {
  const setup = useContext(SetupDisplayContext);
  if (!setup) throw new Error("OCR setup is unavailable");
  return (
    <section className="grid min-w-0 gap-4" aria-labelledby="ocr-record-destination">
      <OcrSectionHeading
        id="ocr-record-destination"
        lead="読み取り結果に引き継ぐ試合設定"
        status={
          <PendingStatus pending={setup.options.refreshing && !setup.options.hasError}>
            試合設定の選択肢を確認中
          </PendingStatus>
        }
        title="記録先"
      />
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
      <OcrSetupPanel view={setup.panel} />
    </section>
  );
}
