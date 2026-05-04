import { fixedMembers } from "@/features/auth/members";
import { computerAliasesFor } from "@/features/ocrCapture/computerAliases";
import type { LayoutFamily } from "@/shared/api/enums";
import type { components } from "@/shared/api/generated";

export type OcrHints = components["schemas"]["OcrJobHints"];

type BuildOcrHintsInput = {
  gameTitleName?: string;
  layoutFamily?: LayoutFamily;
};

export function buildOcrHints({ gameTitleName, layoutFamily }: BuildOcrHintsInput): OcrHints {
  const hints: OcrHints = {
    knownPlayerAliases: fixedMembers.map((member) => ({
      memberId: member.memberId,
      aliases: member.aliases,
    })),
    computerPlayerAliases: [...computerAliasesFor(layoutFamily)],
  };
  if (gameTitleName !== undefined) hints.gameTitle = gameTitleName;
  if (layoutFamily !== undefined) hints.layoutFamily = layoutFamily;
  return hints;
}
