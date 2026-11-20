import * as z from "zod/mini";

import { matchNoteMaximumCharacters, normalizeMatchNote } from "@/features/matches/matchNoteText";
import { matchAchievementSelectionSchema } from "@/features/matches/workspace/matchAchievementSelection";
import { fixedMemberIds } from "@/shared/domain/members";

const memberIds: readonly string[] = fixedMemberIds;
const memberId = z.enum(memberIds);
const incidentCount = z.int().check(z.minimum(0));
const playerPosition = z.int().check(z.minimum(1), z.maximum(4));

const incidentSchema = z.object({
  destination: incidentCount,
  plusStation: incidentCount,
  minusStation: incidentCount,
  cardStation: incidentCount,
  cardShop: incidentCount,
  suriNoGinji: incidentCount,
});

const playerSchema = z.object({
  memberId,
  playOrder: playerPosition,
  rank: playerPosition,
  totalAssetsManYen: z.int(),
  revenueManYen: z.int(),
  incidents: incidentSchema,
});

const playedAtSchema = z.string().check(
  z.minLength(1, "対戦日時を入力してください"),
  z.refine((value) => !Number.isNaN(new Date(value).getTime()), "対戦日時を正しく入力してください"),
);

export const confirmMatchFormSchema = z
  .object({
    heldEventId: z.string().check(z.minLength(1, "開催を選択してください")),
    matchNoInEvent: z.int().check(z.minimum(1, "試合番号は1以上です")),
    gameTitleId: z.string().check(z.minLength(1, "作品を選択してください")),
    seasonMasterId: z.string().check(z.minLength(1, "シーズンを選択してください")),
    ownerMemberId: memberId,
    mapMasterId: z.string().check(z.minLength(1, "マップを選択してください")),
    playedAt: playedAtSchema,
    achievements: z._default(z.array(matchAchievementSelectionSchema), []),
    matchDraftId: z.optional(z.string()),
    draftIds: z.object({
      totalAssets: z.optional(z.string()),
      revenue: z.optional(z.string()),
      incidentLog: z.optional(z.string()),
    }),
    players: z.array(playerSchema).check(z.length(4, "4人分の結果が必要です")),
    noteBody: z
      ._default(z.string(), "")
      .check(
        z.refine(
          (value) => Array.from(normalizeMatchNote(value)).length <= matchNoteMaximumCharacters,
          `試合メモは${matchNoteMaximumCharacters}字以内で入力してください`,
        ),
      ),
  })
  .check(
    z.superRefine((value, ctx) => {
      const achievements = new Set(
        value.achievements.map((entry) => `${entry.achievementId}:${entry.memberId}`),
      );
      if (achievements.size !== value.achievements.length) {
        ctx.addIssue({
          code: "custom",
          path: ["achievements"],
          message: "同じ人の実績は1件ずつ選択してください",
        });
      }
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
    }),
  );

export type ConfirmMatchFormValues = z.input<typeof confirmMatchFormSchema>;
