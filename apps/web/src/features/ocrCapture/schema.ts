import { z } from "zod";

export const setupSchema = z.object({
  gameTitleId: z.string().min(1, "作品を選択してください"),
  seasonMasterId: z.string().min(1, "シーズンを選択してください"),
  mapMasterId: z.string().min(1, "マップを選択してください"),
  ownerMemberId: z.string().min(1, "オーナーを選択してください"),
});

export type SetupFormValues = z.infer<typeof setupSchema>;

export const defaultSetupValues: SetupFormValues = {
  gameTitleId: "",
  seasonMasterId: "",
  mapMasterId: "",
  ownerMemberId: "member_ponta",
};
