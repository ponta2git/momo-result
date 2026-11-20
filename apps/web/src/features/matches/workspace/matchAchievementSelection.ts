import * as z from "zod/mini";

import { fixedMemberIds } from "@/shared/domain/members";

const version = z.string().check(z.regex(/^\d+$/u));

/** Versions are captured when selected; refresh never silently accepts a concurrent correction. */
export const matchAchievementSelectionSchema = z.object({
  achievementId: z.string().check(z.minLength(1)),
  achievementName: z.string(),
  memberId: z.enum(fixedMemberIds),
  expectedItemVersion: version,
  expectedClaimVersion: z.nullable(version),
});

export type MatchAchievementSelection = z.infer<typeof matchAchievementSelectionSchema>;
