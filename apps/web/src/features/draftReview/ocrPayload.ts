import { z } from "zod";

const ocrFieldSchema = <T extends z.ZodType>(valueSchema: T) =>
  z.object({
    value: valueSchema.nullable(),
    raw_text: z.string().nullable(),
    confidence: z.number().nullable(),
    warnings: z.array(z.string()).default([]),
  });

export const ocrNumberFieldSchema = ocrFieldSchema(z.number());
export const ocrStringFieldSchema = ocrFieldSchema(z.string());

export const incidentNames = [
  "目的地",
  "プラス駅",
  "マイナス駅",
  "カード駅",
  "カード売り場",
  "スリの銀次",
] as const;

export type IncidentName = (typeof incidentNames)[number];

const ocrPlayerEntrySchema = z.object({
  raw_player_name: ocrStringFieldSchema,
  member_id: z.string().nullable().optional(),
  play_order: ocrNumberFieldSchema,
  rank: ocrNumberFieldSchema,
  total_assets_man_yen: ocrNumberFieldSchema,
  revenue_man_yen: ocrNumberFieldSchema,
  incidents: z.record(z.string(), ocrNumberFieldSchema).default({}),
});

/**
 * OCR worker が画面種別ごとに付随情報として返す `category_payload`。
 * `parser` キーで画面種別を判別する discriminated union として表現する。
 *
 * - 既知のフィールド以外は worker 側の進化を許容するため `passthrough` で保持する
 * - 旧来の空オブジェクト `{}` 等、`parser` 未設定の payload は legacy fallback で受ける
 */
const baseCategoryFields = {
  status: z.string().optional(),
  rows: z.array(z.unknown()).optional(),
  player_order: z.unknown().optional(),
  include_raw_text: z.boolean().optional(),
} as const;

const totalAssetsCategoryPayloadSchema = z
  .object({ parser: z.literal("total_assets"), ...baseCategoryFields })
  .passthrough();

const revenueCategoryPayloadSchema = z
  .object({ parser: z.literal("revenue"), ...baseCategoryFields })
  .passthrough();

const incidentLogCategoryPayloadSchema = z
  .object({
    parser: z.literal("incident_log"),
    ...baseCategoryFields,
    layout_profile_id: z.string().optional(),
    incident_names: z.array(z.string()).optional(),
  })
  .passthrough();

const legacyCategoryPayloadSchema = z.record(z.string(), z.unknown());

export const ocrCategoryPayloadSchema = z.union([
  z.discriminatedUnion("parser", [
    totalAssetsCategoryPayloadSchema,
    revenueCategoryPayloadSchema,
    incidentLogCategoryPayloadSchema,
  ]),
  legacyCategoryPayloadSchema,
]);

export type OcrCategoryPayload = z.infer<typeof ocrCategoryPayloadSchema>;

const baseDraftFields = {
  detected_screen_type: z.string().nullable(),
  profile_id: z.string().nullable(),
  players: z.array(ocrPlayerEntrySchema).default([]),
  warnings: z.array(z.unknown()).default([]),
  raw_snippets: z.unknown(),
} as const;

/**
 * OCR worker が返す画面種別ごとの draft 本体。
 * `requested_screen_type` を判別子に持つ discriminated union で、
 * 画面種別ごとに紐づく `category_payload` の形を型レベルで限定する。
 */
export const ocrDraftPayloadSchema = z.discriminatedUnion("requested_screen_type", [
  z.object({
    requested_screen_type: z.literal("total_assets"),
    category_payload: z
      .union([totalAssetsCategoryPayloadSchema, legacyCategoryPayloadSchema])
      .default({}),
    ...baseDraftFields,
  }),
  z.object({
    requested_screen_type: z.literal("revenue"),
    category_payload: z
      .union([revenueCategoryPayloadSchema, legacyCategoryPayloadSchema])
      .default({}),
    ...baseDraftFields,
  }),
  z.object({
    requested_screen_type: z.literal("incident_log"),
    category_payload: z
      .union([incidentLogCategoryPayloadSchema, legacyCategoryPayloadSchema])
      .default({}),
    ...baseDraftFields,
  }),
]);

export type OcrField<T> = {
  value: T | null;
  raw_text: string | null;
  confidence: number | null;
  warnings: string[];
};
export type OcrDraftPayload = z.infer<typeof ocrDraftPayloadSchema>;
export type OcrPlayerEntry = z.infer<typeof ocrPlayerEntrySchema>;

export function parseOcrDraftPayload(value: unknown): OcrDraftPayload {
  return ocrDraftPayloadSchema.parse(value);
}

