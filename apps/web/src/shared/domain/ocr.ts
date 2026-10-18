export const slotKinds = ["total_assets", "revenue", "incident_log"] as const;
export type SlotKind = (typeof slotKinds)[number];

export const screenTypes = slotKinds;
export type ScreenType = (typeof screenTypes)[number];

export const ocrJobStatuses = ["queued", "running", "succeeded", "failed", "cancelled"] as const;
export type OcrJobStatus = (typeof ocrJobStatuses)[number];

export const layoutFamilies = ["momotetsu_2", "world", "reiwa"] as const;
export type LayoutFamily = (typeof layoutFamilies)[number];
export const layoutFamilyLabels = {
  momotetsu_2: "桃鉄2向け",
  reiwa: "令和版向け",
  world: "ワールド向け",
} as const satisfies Record<LayoutFamily, string>;

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
  if (typeof value !== "string") return undefined;
  const normalized = value.replaceAll(/^[ \t\r\n\f\v]+|[ \t\r\n\f\v]+$/gu, "").toLowerCase();
  switch (normalized) {
    case "momotetsu_2":
    case "momotetsu2":
    case "2":
      return "momotetsu_2";
    case "world":
    case "momotetsu_world":
    case "default":
      return "world";
    case "reiwa":
    case "momotetsu_reiwa":
      return "reiwa";
    default:
      return undefined;
  }
}
