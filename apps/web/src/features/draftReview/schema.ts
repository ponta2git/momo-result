import { z } from "zod";
import { fixedMembers, gameTitles, seasons } from "@/features/ocrCapture/localMasters";
import type { components } from "@/shared/api/generated";
import { layoutFamilies } from "@/shared/api/enums";

const memberIds = fixedMembers.map((member) => member.memberId) as [string, ...string[]];
const seasonIds = seasons.map((season) => season.id);
const gameTitleNames = gameTitles.map((gameTitle) => gameTitle.displayName);

const incidentSchema = z.object({
  destination: z.number().int().min(0),
  plusStation: z.number().int().min(0),
  minusStation: z.number().int().min(0),
  cardStation: z.number().int().min(0),
  cardShop: z.number().int().min(0),
  suriNoGinji: z.number().int().min(0),
});

const playerSchema = z.object({
  memberId: z.enum(memberIds),
  playOrder: z.number().int().min(1).max(4),
  rank: z.number().int().min(1).max(4),
  totalAssetsManYen: z.number().int().min(0),
  revenueManYen: z.number().int().min(0),
  incidents: incidentSchema,
});

export const confirmMatchSchema = z
  .object({
    heldEventId: z.string().min(1, "開催履歴を選択してください"),
    matchNoInEvent: z.number().int().min(1, "試合番号は1以上です"),
    gameTitle: z.string().refine((value) => gameTitleNames.includes(value), {
      message: "作品を選択してください",
    }),
    layoutFamily: z.enum(layoutFamilies),
    seasonId: z.string().refine((value) => seasonIds.includes(value), {
      message: "シーズンを選択してください",
    }),
    ownerMemberId: z.enum(memberIds),
    mapName: z.string().min(1, "マップを選択してください"),
    playedAt: z.string().min(1, "開催日時を入力してください"),
    draftIds: z.object({
      totalAssets: z.string().optional(),
      revenue: z.string().optional(),
      incidentLog: z.string().optional(),
    }),
    players: z.array(playerSchema).length(4, "4人分の結果が必要です"),
  })
  .superRefine((value, ctx) => {
    const memberSet = new Set(value.players.map((player) => player.memberId));
    if (memberSet.size !== 4) {
      ctx.addIssue({
        code: "custom",
        path: ["players"],
        message: "4人全員を重複なく選択してください",
      });
    }
    for (const key of ["playOrder", "rank"] as const) {
      const set = new Set(value.players.map((player) => player[key]));
      if (set.size !== 4 || ![1, 2, 3, 4].every((number) => set.has(number))) {
        ctx.addIssue({
          code: "custom",
          path: ["players"],
          message:
            key === "playOrder"
              ? "プレー順は1〜4を重複なく入力してください"
              : "順位は1〜4を重複なく入力してください",
        });
      }
    }
  });

export type ConfirmMatchFormValues = z.infer<typeof confirmMatchSchema>;
export type ConfirmMatchRequest = components["schemas"]["ConfirmMatchRequest"];

export function toConfirmMatchRequest(values: ConfirmMatchFormValues): ConfirmMatchRequest {
  const draftIds: ConfirmMatchRequest["draftIds"] = {};
  if (values.draftIds.totalAssets) draftIds.totalAssets = values.draftIds.totalAssets;
  if (values.draftIds.revenue) draftIds.revenue = values.draftIds.revenue;
  if (values.draftIds.incidentLog) draftIds.incidentLog = values.draftIds.incidentLog;
  return { ...values, draftIds };
}
