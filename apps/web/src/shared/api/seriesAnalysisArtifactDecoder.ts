import { seriesAnalysisArtifactValidatorLoaders } from "@/shared/api/generatedContracts/series-analysis-artifact-contracts.generated";
import type { SeriesAnalysisArtifactResponseByContract } from "@/shared/api/generatedContracts/series-analysis-artifact-contracts.generated";
import { decodeSeriesAnalysisContract } from "@/shared/api/seriesAnalysisContractDecoder";

export type ArtifactContractId = keyof SeriesAnalysisArtifactResponseByContract;

export function decodeSeriesAnalysisArtifact<K extends ArtifactContractId>(
  kind: K,
  value: unknown,
): Promise<SeriesAnalysisArtifactResponseByContract[K]> {
  return decodeSeriesAnalysisContract(
    `artifact:${kind}`,
    kind,
    seriesAnalysisArtifactValidatorLoaders[kind],
    value,
  );
}
