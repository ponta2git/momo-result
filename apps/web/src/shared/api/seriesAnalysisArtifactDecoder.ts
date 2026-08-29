import { seriesAnalysisArtifactSchemaLoaders } from "@/shared/api/generatedContracts/series-analysis-artifact-contracts.generated";
import type { SeriesAnalysisArtifactResponseByKind } from "@/shared/api/generatedContracts/series-analysis-artifact-contracts.generated";
import { decodeSeriesAnalysisContract } from "@/shared/api/seriesAnalysisContractDecoder";

export type ArtifactResourceKind = keyof SeriesAnalysisArtifactResponseByKind;

export function decodeSeriesAnalysisArtifact<K extends ArtifactResourceKind>(
  kind: K,
  value: unknown,
): Promise<SeriesAnalysisArtifactResponseByKind[K]> {
  return decodeSeriesAnalysisContract(
    `artifact:${kind}`,
    kind,
    seriesAnalysisArtifactSchemaLoaders[kind],
    value,
  );
}
