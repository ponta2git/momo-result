export const incidentDefinitions = [
  { key: "destination", label: "目的地", ocrName: "目的地" },
  { key: "plusStation", label: "プラス駅", ocrName: "プラス駅" },
  { key: "minusStation", label: "マイナス駅", ocrName: "マイナス駅" },
  { key: "cardStation", label: "カード駅", ocrName: "カード駅" },
  { key: "cardShop", label: "カード売り場", ocrName: "カード売り場" },
  { key: "suriNoGinji", label: "スリの銀次", ocrName: "スリの銀次" },
] as const;

export type IncidentDefinition = (typeof incidentDefinitions)[number];
export type IncidentKey = IncidentDefinition["key"];
export type IncidentLabel = IncidentDefinition["label"];
export type IncidentOcrName = IncidentDefinition["ocrName"];
export type IncidentCountsByKey = Record<IncidentKey, number>;
export type IncidentCountsByLabel = Record<IncidentLabel, number>;

export const incidentColumns = incidentDefinitions.map((definition) => [
  definition.key,
  definition.label,
]) as ReadonlyArray<readonly [IncidentKey, IncidentLabel]>;

export const incidentOcrNames = incidentDefinitions.map(
  (definition) => definition.ocrName,
) as readonly IncidentOcrName[];

export function emptyIncidentCountsByKey(): IncidentCountsByKey {
  return Object.fromEntries(
    incidentDefinitions.map((definition) => [definition.key, 0]),
  ) as IncidentCountsByKey;
}

export function emptyIncidentCountsByLabel(): IncidentCountsByLabel {
  return Object.fromEntries(
    incidentDefinitions.map((definition) => [definition.label, 0]),
  ) as IncidentCountsByLabel;
}

export function incidentCountsByLabelToKey(
  counts: Partial<Record<IncidentLabel, number>>,
): IncidentCountsByKey {
  return Object.fromEntries(
    incidentDefinitions.map((definition) => [definition.key, counts[definition.label] ?? 0]),
  ) as IncidentCountsByKey;
}
