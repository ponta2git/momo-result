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

export const ocrDraftPayloadSchema = z.object({
  requested_screen_type: z.enum(["total_assets", "revenue", "incident_log"]),
  detected_screen_type: z.string().nullable(),
  profile_id: z.string().nullable(),
  players: z.array(ocrPlayerEntrySchema).default([]),
  category_payload: z.unknown(),
  warnings: z.array(z.unknown()).default([]),
  raw_snippets: z.unknown(),
});

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
