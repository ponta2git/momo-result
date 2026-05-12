import { computerAliasesFor } from "@/features/ocrCapture/computerAliases";
import type { LayoutFamily } from "@/shared/api/enums";
import type { components } from "@/shared/api/generated";
import { defaultMemberAliasDirectory, playerAliasHints } from "@/shared/domain/memberDirectory";
import type { MemberAliasDirectory } from "@/shared/domain/memberDirectory";

export type OcrHints = components["schemas"]["OcrJobHints"];

type BuildOcrHintsInput = {
  gameTitleName?: string;
  layoutFamily?: LayoutFamily;
};

export function buildOcrHints(
  { gameTitleName, layoutFamily }: BuildOcrHintsInput,
  memberDirectory: MemberAliasDirectory = defaultMemberAliasDirectory,
): OcrHints {
  const hints: OcrHints = {
    knownPlayerAliases: playerAliasHints(memberDirectory),
    computerPlayerAliases: [...computerAliasesFor(layoutFamily)],
  };
  if (gameTitleName !== undefined) hints.gameTitle = gameTitleName;
  if (layoutFamily !== undefined) hints.layoutFamily = layoutFamily;
  return hints;
}
