export function heldEventOcrCaptureHref(heldEventId: string): string {
  const params = new URLSearchParams({ heldEventId });
  return `/ocr/new?${params.toString()}`;
}
