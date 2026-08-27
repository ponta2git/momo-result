import type { OcrJobSlotSynchronizationOptions } from "@/features/ocrCapture/useOcrJobSlotSynchronization";
import { useOcrJobSlotSynchronization } from "@/features/ocrCapture/useOcrJobSlotSynchronization";

export function OcrJobSlotStatusLoader(props: OcrJobSlotSynchronizationOptions) {
  useOcrJobSlotSynchronization(props);
  return null;
}
