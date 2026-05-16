import { useEffect, useState } from "react";

import { slotDefinitions } from "@/features/ocrCapture/captureState";
import { defaultSetupValues } from "@/features/ocrCapture/schema";
import type { SetupFormValues } from "@/features/ocrCapture/schema";
import { isWorkingStatus } from "@/features/ocrCapture/slotPolicy";
import { useOcrCaptureDraftFlow } from "@/features/ocrCapture/useOcrCaptureDraftFlow";
import { useOcrCaptureMutations } from "@/features/ocrCapture/useOcrCaptureMutations";
import { useOcrCaptureQueries } from "@/features/ocrCapture/useOcrCaptureQueries";
import type { NormalizedApiError } from "@/shared/api/problemDetails";
import { showToast } from "@/shared/ui/feedback/Toast";

export function useOcrCapturePageController() {
  const [setup, setSetup] = useState<SetupFormValues>(defaultSetupValues);
  const [notice, setNotice] = useState("");
  const [partialStartAcknowledged, setPartialStartAcknowledged] = useState(false);

  const { auth, gameTitlesQuery, hints } = useOcrCaptureQueries(setup.gameTitleId);
  const flow = useOcrCaptureDraftFlow();
  const submission = useOcrCaptureMutations(hints);

  function notify(message: string, tone: "info" | "success" | "warning" = "info") {
    setNotice(message);
    showToast({ title: message, tone });
  }

  function handleValidationError(message: string) {
    notify(message);
  }

  const ocrReadyCount = flow.slots.filter(
    (slot) => slot.file && ["selected", "failed", "cancelled"].includes(slot.status),
  ).length;
  const hasWorkingSlot = flow.slots.some((slot) => isWorkingStatus(slot.status));
  const slotsFull = flow.slots.every((slot) => Boolean(slot.file));
  const selectedSlotLabels = slotDefinitions
    .filter((definition) =>
      flow.slots.some(
        (slot) =>
          slot.kind === definition.kind &&
          slot.file &&
          ["selected", "failed", "cancelled"].includes(slot.status),
      ),
    )
    .map((definition) => definition.label);

  useEffect(() => {
    setPartialStartAcknowledged(false);
  }, [ocrReadyCount]);

  async function handleStartOcr() {
    if (ocrReadyCount < slotDefinitions.length && !partialStartAcknowledged) {
      setPartialStartAcknowledged(true);
      notify(
        "3種類すべての画像は揃っていません。このまま進める場合は、もう一度開始してください。",
        "warning",
      );
      return;
    }
    const selectedGameTitle = gameTitlesQuery.data?.items?.find(
      (item) => item.id === setup.gameTitleId,
    );
    await submission.submit({
      notify,
      selectedGameTitle,
      setup,
      slots: flow.slots,
      updateSlot: flow.updateSlot,
    });
  }

  function handleDraftLoadError(error: NormalizedApiError) {
    notify(error.detail || error.title, "warning");
  }

  return {
    auth,
    flow,
    handleDraftLoadError,
    handleStartOcr,
    handleValidationError,
    hasWorkingSlot,
    notice,
    notify,
    ocrReadyCount,
    partialStartAcknowledged,
    selectedSlotLabels,
    setSetup,
    setup,
    slotsFull,
    submission,
  };
}
