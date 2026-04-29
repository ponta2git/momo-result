import type { components } from "@/shared/api/generated";
import type { RequestedImageType, SlotKind } from "@/shared/api/enums";
import { parseSlotKind } from "@/shared/api/enums";
import type { NormalizedApiError } from "@/shared/api/problemDetails";

export type InputSource = "upload" | "camera";

export type SlotStatus =
  | "empty"
  | "selected"
  | "uploading"
  | "uploaded"
  | "queueing"
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export type CaptureSlotState = {
  kind: SlotKind;
  source?: InputSource | undefined;
  file?: File | undefined;
  previewUrl?: string | undefined;
  cameraStream?: MediaStream | undefined;
  imageId?: string | undefined;
  jobId?: string | undefined;
  draftId?: string | undefined;
  detectedKind?: SlotKind | undefined;
  status: SlotStatus;
  transportError?: NormalizedApiError | undefined;
  jobFailure?: components["schemas"]["OcrFailureResponse"] | undefined;
  pollAttempts: number;
};

export const slotDefinitions: Array<{ kind: SlotKind; label: string; accentClass: string }> = [
  { kind: "total_assets", label: "総資産", accentClass: "from-rail-blue/70 to-sky-300/20" },
  { kind: "revenue", label: "収益", accentClass: "from-rail-gold/70 to-yellow-300/20" },
  { kind: "incident_log", label: "事件簿", accentClass: "from-rail-magenta/70 to-fuchsia-300/20" },
];

export function createInitialSlot(kind: SlotKind): CaptureSlotState {
  return {
    kind,
    status: "empty",
    pollAttempts: 0,
  };
}

export function createInitialSlots(): CaptureSlotState[] {
  return slotDefinitions.map((definition) => createInitialSlot(definition.kind));
}

export function requestedImageTypeForSlot(
  slot: Pick<CaptureSlotState, "kind">,
): RequestedImageType {
  return slot.kind;
}

export function detectedKindFromResponse(value: unknown): SlotKind | undefined {
  return parseSlotKind(value);
}

export function releaseSlotResources(slot: CaptureSlotState): void {
  if (slot.previewUrl) {
    URL.revokeObjectURL(slot.previewUrl);
  }

  if (slot.cameraStream) {
    for (const track of slot.cameraStream.getTracks()) {
      track.stop();
    }
  }
}

export function validateImageFile(file: File): string | undefined {
  if (file.size > 3 * 1024 * 1024) {
    return "画像サイズは3MB以下にしてください。";
  }

  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    return "PNG / JPEG / WebP の画像を選択してください。";
  }

  return undefined;
}
