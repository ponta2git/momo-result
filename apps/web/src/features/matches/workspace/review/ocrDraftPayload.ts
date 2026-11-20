import * as z from "zod/mini";

import { incidentOcrNames } from "@/shared/domain/incidents";
import type { IncidentOcrName } from "@/shared/domain/incidents";
import { parseSchema } from "@/shared/lib/schemaValidation";

const structuredOcrWarningSchema = z.object({
  code: z.string(),
  field_path: z._default(z.nullable(z.string()), null),
  message: z.string(),
  severity: z._default(z.string(), "warning"),
});

const ocrWarningSchema = z.union([
  structuredOcrWarningSchema,
  z.pipe(
    z.string(),
    z.transform((message) => ({
      code: "LEGACY_WARNING",
      field_path: null,
      message,
      severity: "warning",
    })),
  ),
]);

const warningsSchema = z._default(z.array(ocrWarningSchema), []);
const ocrFieldSchema = <T extends z.ZodMiniType>(valueSchema: T) =>
  z.object({
    value: z.nullable(valueSchema),
    raw_text: z.nullable(z.string()),
    confidence: z.nullable(z.number()),
    warnings: warningsSchema,
  });

const ocrNumberFieldSchema = ocrFieldSchema(z.number());
const ocrStringFieldSchema = ocrFieldSchema(z.string());

export const incidentNames = incidentOcrNames;

export type IncidentName = IncidentOcrName;

const ocrPlayerEntrySchema = z.object({
  raw_player_name: ocrStringFieldSchema,
  member_id: z.nullish(z.string()),
  play_order: ocrNumberFieldSchema,
  rank: ocrNumberFieldSchema,
  total_assets_man_yen: ocrNumberFieldSchema,
  revenue_man_yen: ocrNumberFieldSchema,
  incidents: z._default(z.record(z.string(), ocrNumberFieldSchema), {}),
});

/**
 * OCR worker が画面種別ごとに付随情報として返す `category_payload`。
 * `parser` キーで画面種別を判別する discriminated union として表現する。
 *
 * - 既知のフィールド以外も worker 側の進化を許容するため保持する
 * - 旧来の空オブジェクト `{}` 等、`parser` 未設定の payload は legacy fallback で受ける
 */
const baseCategoryFields = {
  status: z.optional(z.string()),
  rows: z.optional(z.array(z.unknown())),
  player_order: z.optional(z.unknown()),
  include_raw_text: z.optional(z.boolean()),
} as const;

const totalAssetsCategoryPayloadSchema = z.looseObject({
  parser: z.literal("total_assets"),
  ...baseCategoryFields,
});

const revenueCategoryPayloadSchema = z.looseObject({
  parser: z.literal("revenue"),
  ...baseCategoryFields,
});

const incidentLogCategoryPayloadSchema = z.looseObject({
  parser: z.literal("incident_log"),
  ...baseCategoryFields,
  layout_profile_id: z.optional(z.string()),
  incident_names: z.optional(z.array(z.string())),
});

const legacyCategoryPayloadSchema = z.record(z.string(), z.unknown());

const baseDraftFields = {
  detected_screen_type: z.nullable(z.string()),
  profile_id: z.nullable(z.string()),
  players: z._default(z.array(ocrPlayerEntrySchema), []),
  warnings: warningsSchema,
  raw_snippets: z.unknown(),
} as const;

/**
 * OCR worker が返す画面種別ごとの draft 本体。
 * `requested_screen_type` を判別子に持つ discriminated union で、
 * 画面種別ごとに紐づく `category_payload` の形を型レベルで限定する。
 */
const ocrDraftPayloadSchema = z.discriminatedUnion("requested_screen_type", [
  z.object({
    requested_screen_type: z.literal("total_assets"),
    category_payload: z._default(
      z.union([totalAssetsCategoryPayloadSchema, legacyCategoryPayloadSchema]),
      {},
    ),
    ...baseDraftFields,
  }),
  z.object({
    requested_screen_type: z.literal("revenue"),
    category_payload: z._default(
      z.union([revenueCategoryPayloadSchema, legacyCategoryPayloadSchema]),
      {},
    ),
    ...baseDraftFields,
  }),
  z.object({
    requested_screen_type: z.literal("incident_log"),
    category_payload: z._default(
      z.union([incidentLogCategoryPayloadSchema, legacyCategoryPayloadSchema]),
      {},
    ),
    ...baseDraftFields,
  }),
]);

export type OcrField<T> = {
  value: T | null;
  raw_text: string | null;
  confidence: number | null;
  warnings: OcrWarning[];
};
export type OcrWarning = z.infer<typeof ocrWarningSchema>;
export type OcrDraftPayload = z.infer<typeof ocrDraftPayloadSchema>;
export type OcrPlayerEntry = z.infer<typeof ocrPlayerEntrySchema>;

export function parseOcrDraftPayload(value: unknown): OcrDraftPayload {
  return parseSchema(ocrDraftPayloadSchema, value);
}

export function parseOcrWarningList(value: unknown): OcrWarning[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    const parsed = ocrWarningSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}
