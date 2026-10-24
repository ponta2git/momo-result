import { z } from "zod";

import { fixedMemberIds } from "@/shared/domain/members";

/** Versions are captured when selected; refresh never silently accepts a concurrent correction. */
export const matchAchievementSelectionSchema = z.object({
  achievementId: z.string().min(1),
  achievementName: z.string(),
  memberId: z.enum(fixedMemberIds),
  expectedItemVersion: z.string().regex(/^\d+$/u),
  expectedClaimVersion: z.string().regex(/^\d+$/u).nullable(),
});

export type MatchAchievementSelection = z.infer<typeof matchAchievementSelectionSchema>;
