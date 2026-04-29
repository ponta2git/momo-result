import type { components } from "@/shared/api/generated";
import { findGameTitle, fixedMembers } from "@/features/ocrCapture/localMasters";
import type { GameTitleId } from "@/features/ocrCapture/localMasters";

export type OcrHints = components["schemas"]["OcrJobHints"];

type BuildOcrHintsInput = {
  gameTitleId: GameTitleId;
};

export function buildOcrHints({ gameTitleId }: BuildOcrHintsInput): OcrHints {
  const gameTitle = findGameTitle(gameTitleId);

  return {
    gameTitle: gameTitle.displayName,
    layoutFamily: gameTitle.layoutFamily,
    knownPlayerAliases: fixedMembers.map((member) => ({
      memberId: member.memberId,
      // Worker ignores aliases shorter than five normalized characters to avoid false matches.
      aliases: member.aliases,
    })),
    computerPlayerAliases: gameTitle.computerPlayerAliases,
  };
}
