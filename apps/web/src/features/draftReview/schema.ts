import { z } from "zod";

import { fixedMembers } from "@/features/ocrCapture/localMasters";
import type { components } from "@/shared/api/generated";

const memberIds = fixedMembers.map((member) => member.memberId) as [string, ...string[]];

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
  totalAssetsManYen: z.number().int(),
  revenueManYen: z.number().int(),
  incidents: incidentSchema,
});

export type ConfirmMatchRequest = components["schemas"]["ConfirmMatchRequest"];

function toIsoFromLocal(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function pruneDraftIds(values: {
  totalAssets?: string | undefined;
  revenue?: string | undefined;
  incidentLog?: string | undefined;
}): ConfirmMatchRequest["draftIds"] {
  const next: ConfirmMatchRequest["draftIds"] = {};
  if (values.totalAssets) next.totalAssets = values.totalAssets;
  if (values.revenue) next.revenue = values.revenue;
  if (values.incidentLog) next.incidentLog = values.incidentLog;
  return next;
}

/**
 * フォーム値を検証しつつ `ConfirmMatchRequest` (= API リクエスト DTO) に変換する。
 *
 * `transform()` を末尾に置くことで「parse → validate → reshape」を 1 段にまとめ、
 * 呼び出し側で個別に request 整形関数を用意する必要をなくしている。
 */
export const confirmMatchSchema = z
  .object({
    heldEventId: z.string().min(1, "開催履歴を選択してください"),
    matchNoInEvent: z.number().int().min(1, "試合番号は1以上です"),
    gameTitleId: z.string().min(1, "作品を選択してください"),
    seasonMasterId: z.string().min(1, "シーズンを選択してください"),
    ownerMemberId: z.enum(memberIds),
    mapMasterId: z.string().min(1, "マップを選択してください"),
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
  })
  .transform(
    (values): ConfirmMatchRequest => ({
      ...values,
      draftIds: pruneDraftIds(values.draftIds),
      playedAt: toIsoFromLocal(values.playedAt),
    }),
  );

/** フォーム入力時の値の型 (transform 適用前)。 */
export type ConfirmMatchFormValues = z.input<typeof confirmMatchSchema>;

