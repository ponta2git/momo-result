export const slotKinds = ["total_assets", "revenue", "incident_log"] as const;
export type SlotKind = (typeof slotKinds)[number];

export const requestedImageTypes = ["auto", ...slotKinds] as const;
export type RequestedImageType = (typeof requestedImageTypes)[number];

export const ocrJobStatuses = ["queued", "running", "succeeded", "failed", "cancelled"] as const;
export type OcrJobStatus = (typeof ocrJobStatuses)[number];

export const layoutFamilies = ["momotetsu_2", "world", "reiwa"] as const;
export type LayoutFamily = (typeof layoutFamilies)[number];
export const layoutFamilyLabels = {
  momotetsu_2: "桃鉄2向け",
  reiwa: "令和版向け",
  world: "ワールド向け",
} as const satisfies Record<LayoutFamily, string>;

export const terminalJobStatuses = ["succeeded", "failed", "cancelled"] as const;

function isOneOf<const T extends readonly string[]>(value: unknown, list: T): value is T[number] {
  return typeof value === "string" && list.includes(value);
}

export function parseSlotKind(value: unknown): SlotKind | undefined {
  return isOneOf(value, slotKinds) ? value : undefined;
}

export function parseOcrJobStatus(value: unknown): OcrJobStatus | "unknown" {
  return isOneOf(value, ocrJobStatuses) ? value : "unknown";
}

export function parseLayoutFamily(value: unknown): LayoutFamily | undefined {
  return isOneOf(value, layoutFamilies) ? value : undefined;
}

export function isTerminalJobStatus(value: unknown): value is (typeof terminalJobStatuses)[number] {
  return isOneOf(value, terminalJobStatuses);
}
