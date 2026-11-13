import type {
  IncidentLookupEntry,
  OriginalPlayerSnapshot,
} from "@/features/matches/workspace/matchFormTypes";
import type { MatchNumericDrafts } from "@/features/matches/workspace/matchNumericDrafts";
import type { ReviewFieldKey } from "@/features/matches/workspace/review/reviewWarningModel";
import { incidentDefinitions } from "@/shared/domain/incidents";
import type { IncidentKey } from "@/shared/domain/incidents";

/** Player values the OCR result can leave without a reading. */
export type UnreadPlayerField = "rank" | "totalAssetsManYen" | "revenueManYen";
export type UnreadField = UnreadPlayerField | `incident.${IncidentKey}`;

const noUnreadFields: readonly UnreadField[] = [];

/**
 * A value OCR could not read has no number to show, so its input starts empty instead of
 * pretending to be 0 (UI rule: 読み取れなかった値、未確認の値、実際の 0 を区別する). Incident
 * counts follow the row's play order, the column they were read from, so a play-order change
 * changes which of them are unread.
 */
export function unreadFieldsOf(args: {
  incidentByPlayOrder: ReadonlyMap<number, IncidentLookupEntry> | undefined;
  original: OriginalPlayerSnapshot | undefined;
  playOrder: number;
}): readonly UnreadField[] {
  if (!args.original) return noUnreadFields;
  const fields: UnreadField[] = [...(args.original.unread ?? [])];
  if (args.incidentByPlayOrder) {
    const entry = args.incidentByPlayOrder.get(args.playOrder);
    for (const definition of incidentDefinitions) {
      if (!entry || entry.unread?.includes(definition.label)) {
        fields.push(`incident.${definition.key}`);
      }
    }
  }
  return fields.length === 0 ? noUnreadFields : fields;
}

export function unreadFieldPath(row: number, field: UnreadField): string {
  return field.startsWith("incident.")
    ? `players.${row}.incidents.${field.slice("incident.".length)}`
    : `players.${row}.${field}`;
}

export function isUnreadField(field: ReviewFieldKey): field is UnreadField {
  return field !== "memberId" && field !== "playOrder";
}

/** Empty inputs for the given unread values, keeping every other unfinished text. */
export function withEmptyUnreadInputs(
  drafts: MatchNumericDrafts | undefined,
  row: number,
  fields: readonly UnreadField[],
): MatchNumericDrafts {
  return {
    ...drafts,
    ...Object.fromEntries(fields.map((field) => [unreadFieldPath(row, field), ""])),
  };
}
