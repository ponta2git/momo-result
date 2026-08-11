import type { SlotKind } from "@/shared/api/enums";
import type { IncidentKey, IncidentLabel } from "@/shared/domain/incidents";

import type { OcrWarning } from "./ocrDraftPayload";

export type ReviewFieldKey =
  | "memberId"
  | "playOrder"
  | "rank"
  | "totalAssetsManYen"
  | "revenueManYen"
  | `incident.${IncidentKey}`;

export type ReviewFieldEvidence = {
  confidence: number | null;
  sourceKind: SlotKind;
  warnings: OcrWarning[];
};

export type ReviewPlayerEvidence = {
  incidents: Partial<Record<IncidentLabel, ReviewFieldEvidence>>;
  member?: ReviewFieldEvidence | undefined;
  playOrder?: ReviewFieldEvidence | undefined;
  rank?: ReviewFieldEvidence | undefined;
  revenue?: ReviewFieldEvidence | undefined;
  totalAssets?: ReviewFieldEvidence | undefined;
};

type WarningTarget = {
  field: string;
  playerIndex: number;
};

const playerFieldPattern = /^players\[(\d+)\]\.(.+)$/u;
const quotedIncidentPattern = /^incidents\[['"](.+?)['"]\]$/u;

export function reviewCellId(row: number, field: ReviewFieldKey): string {
  return `player-${row}-${field}`;
}

export function parseWarningTarget(fieldPath: string | null): WarningTarget | null {
  if (!fieldPath) {
    return null;
  }
  const playerMatch = playerFieldPattern.exec(fieldPath);
  if (!playerMatch) {
    return null;
  }
  const playerIndex = Math.trunc(Number(playerMatch[1] ?? ""));
  const rawField = playerMatch[2];
  if (!Number.isFinite(playerIndex) || !rawField) {
    return null;
  }
  const incidentMatch = quotedIncidentPattern.exec(rawField);
  return {
    field: incidentMatch?.[1] ? `incidents.${incidentMatch[1]}` : rawField,
    playerIndex,
  };
}

function warningIdentity(warning: OcrWarning): string {
  return `${warning.code}\u0000${warning.field_path ?? ""}\u0000${warning.message}`;
}

export function dedupeOcrWarnings(warnings: readonly OcrWarning[]): OcrWarning[] {
  const seen = new Set<string>();
  return warnings.filter((warning) => {
    const identity = warningIdentity(warning);
    if (seen.has(identity)) {
      return false;
    }
    seen.add(identity);
    return true;
  });
}

export function buildFieldEvidence(args: {
  attachedWarnings: Set<OcrWarning>;
  confidence: number | null | undefined;
  embeddedWarnings?: readonly OcrWarning[] | undefined;
  fieldNames: readonly string[];
  playerIndex: number;
  sourceKind: SlotKind;
  warnings: readonly OcrWarning[];
}): ReviewFieldEvidence {
  const matched = args.warnings.filter((warning) => {
    const target = parseWarningTarget(warning.field_path);
    return target?.playerIndex === args.playerIndex && args.fieldNames.includes(target.field);
  });
  matched.forEach((warning) => args.attachedWarnings.add(warning));

  return {
    confidence: args.confidence ?? null,
    sourceKind: args.sourceKind,
    warnings: dedupeOcrWarnings([...(args.embeddedWarnings ?? []), ...matched]),
  };
}

export function mergeFieldEvidence(
  sourceKind: SlotKind,
  evidence: readonly ReviewFieldEvidence[],
): ReviewFieldEvidence {
  const confidences = evidence
    .map((item) => item.confidence)
    .filter((value): value is number => value !== null);
  return {
    confidence: confidences.length > 0 ? Math.min(...confidences) : null,
    sourceKind,
    warnings: dedupeOcrWarnings(evidence.flatMap((item) => item.warnings)),
  };
}

const warningCopyByCode: Record<string, string> = {
  AMBIGUOUS_RANK: "順位の読み取りが曖昧です。元画像と照合してください。",
  DUPLICATE_MEMBER_ALIAS: "同じメンバーに見える行が複数あります。割り当てを確認してください。",
  LOW_CONFIDENCE: "読み取りの確度が低いため、元画像と照合してください。",
  MISSING_AMOUNT: "金額を読み取れませんでした。元画像を見て入力してください。",
  MISSING_INCIDENT_COUNT: "事件数を読み取れませんでした。元画像を見て入力してください。",
  PLAYER_ORDER_UNDETECTED: "プレー順を特定できませんでした。色と事件簿を確認してください。",
  SUSPICIOUS_INCIDENT_COUNT: "事件数が通常より大きく見えます。元画像と照合してください。",
  UNKNOWN_PLAYER_ALIAS: "プレイヤー名を特定できませんでした。メンバーを確認してください。",
};

export function reviewWarningMessage(warning: OcrWarning): string {
  return warningCopyByCode[warning.code] ?? warning.message;
}
