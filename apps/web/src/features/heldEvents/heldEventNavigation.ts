import { withReturnTo } from "@/shared/navigation/returnTo";

export function heldEventOcrCaptureHref(heldEventId: string, returnTo: string): string {
  const params = new URLSearchParams({ heldEventId });
  return withReturnTo(`/ocr/new?${params.toString()}`, returnTo);
}
