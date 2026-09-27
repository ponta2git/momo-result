import type { MatchFormValues } from "@/features/matches/workspace/matchFormTypes";
import { incidentDefinitions } from "@/shared/domain/incidents";

/** Uncommitted text belongs to the workspace, including across responsive editor changes. */
export type MatchNumericDrafts = Readonly<Record<string, string>>;

export function numericDraftInput(value: number, draft: string | undefined): number | string {
  if (draft === undefined) return value;
  return /^-?\d+$/u.test(draft) ? Number(draft) : draft;
}

/** Validation and request conversion read the same visible input, never the previous number. */
export function matchFormInput(values: MatchFormValues) {
  const drafts = values.numericDrafts;
  if (!drafts || Object.keys(drafts).length === 0) return values;
  return {
    ...values,
    players: values.players.map((player, index) => ({
      ...player,
      rank: numericDraftInput(player.rank, drafts[`players.${index}.rank`]),
      totalAssetsManYen: numericDraftInput(
        player.totalAssetsManYen,
        drafts[`players.${index}.totalAssetsManYen`],
      ),
      revenueManYen: numericDraftInput(
        player.revenueManYen,
        drafts[`players.${index}.revenueManYen`],
      ),
      incidents: Object.fromEntries(
        incidentDefinitions.map(({ key }) => [
          key,
          numericDraftInput(player.incidents[key], drafts[`players.${index}.incidents.${key}`]),
        ]),
      ),
    })),
  };
}
