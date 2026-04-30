import { z } from "zod";
import { seasons } from "@/features/ocrCapture/localMasters";

const seasonIds = seasons.map((season) => season.id);

export const setupSchema = z.object({
  gameTitleId: z.enum(["momotetsu_2", "world", "reiwa"], {
    message: "作品を選択してください",
  }),
  seasonId: z.string().refine((value) => seasonIds.includes(value), {
    message: "シーズンを選択してください",
  }),
  mapName: z.string().min(1, "マップを選択してください"),
  ownerMemberId: z.string().min(1, "オーナーを選択してください"),
});

export type SetupFormValues = z.infer<typeof setupSchema>;

export const defaultSetupValues: SetupFormValues = {
  gameTitleId: "momotetsu_2",
  seasonId: "season-current",
  mapName: "東日本編",
  ownerMemberId: "member_ponta",
};
