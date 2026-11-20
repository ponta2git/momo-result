import * as z from "zod/mini";

import { safeParseSchema } from "@/shared/lib/schemaValidation";

const ocrSetupSchema = z
  .object({
    gameTitleId: z.string().check(z.minLength(1, "作品を選択してください")),
    heldEventId: z.optional(z.string()),
    mapMasterId: z.string().check(z.minLength(1, "マップを選択してください")),
    matchNoInEvent: z.optional(z.int().check(z.minimum(1, "試合番号は1以上です"))),
    ownerMemberId: z.string().check(z.minLength(1, "オーナーを選択してください")),
    seasonMasterId: z.string().check(z.minLength(1, "シーズンを選択してください")),
  })
  .check(
    z.refine((value) => !value.heldEventId || Boolean(value.matchNoInEvent), {
      message: "開催を選んだ場合は試合番号を入力してください",
      path: ["matchNoInEvent"],
    }),
  );

export type OcrSetupValues = z.infer<typeof ocrSetupSchema>;

export function validateOcrSetup(value: OcrSetupValues) {
  return safeParseSchema(ocrSetupSchema, value);
}

export const defaultOcrSetupValues: OcrSetupValues = {
  gameTitleId: "",
  heldEventId: "",
  seasonMasterId: "",
  mapMasterId: "",
  matchNoInEvent: undefined,
  ownerMemberId: "member_ponta",
};
