import { z } from "zod";

export const setupSchema = z
  .object({
    gameTitleId: z.string().min(1, "作品を選択してください"),
    heldEventId: z.string().optional(),
    mapMasterId: z.string().min(1, "マップを選択してください"),
    matchNoInEvent: z.number().int().min(1, "試合番号は1以上です").optional(),
    ownerMemberId: z.string().min(1, "オーナーを選択してください"),
    seasonMasterId: z.string().min(1, "シーズンを選択してください"),
  })
  .superRefine((value, context) => {
    if (value.heldEventId && !value.matchNoInEvent) {
      context.addIssue({
        code: "custom",
        message: "開催を選んだ場合は試合番号を入力してください",
        path: ["matchNoInEvent"],
      });
    }
  });

export type SetupFormValues = z.infer<typeof setupSchema>;

export const defaultSetupValues: SetupFormValues = {
  gameTitleId: "",
  heldEventId: "",
  seasonMasterId: "",
  mapMasterId: "",
  matchNoInEvent: undefined,
  ownerMemberId: "member_ponta",
};
