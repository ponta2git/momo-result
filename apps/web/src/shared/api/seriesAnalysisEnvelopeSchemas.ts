import type { components } from "@/shared/api/generated";
import type {
  SeriesAnalysisAdminOverview,
  SeriesAnalysisRecalculationAccepted,
} from "@/shared/api/seriesAnalysisAdminTypes";
import { decodeSeriesAnalysisContract } from "@/shared/api/seriesAnalysisContractDecoder";
import type { ContractValidatorLoader } from "@/shared/api/seriesAnalysisContractDecoder";
import type {
  SeriesAnalysisOptionsResponse,
  SeriesAnalysisStatusResponse,
} from "@/shared/api/seriesAnalysisCoreTypes";

type EnvelopeResponseByName = {
  SeriesAnalysisAdminOverviewResponse: components["schemas"]["SeriesAnalysisAdminOverviewResponse"];
  SeriesAnalysisOptionsResponse: components["schemas"]["SeriesAnalysisOptionsResponse"];
  SeriesAnalysisRecalculationAcceptedResponse: components["schemas"]["SeriesAnalysisRecalculationAcceptedResponse"];
  SeriesAnalysisStatusResponse: components["schemas"]["SeriesAnalysisStatusResponse"];
};

type EnvelopeName = keyof EnvelopeResponseByName;

const envelopeValidatorLoaders = {
  SeriesAnalysisAdminOverviewResponse: async () =>
    (await import("@/shared/api/generatedContracts/series-analysis-validators.generated"))
      .validateSeriesAnalysisAdminOverviewResponse,
  SeriesAnalysisOptionsResponse: async () =>
    (await import("@/shared/api/generatedContracts/series-analysis-validators.generated"))
      .validateSeriesAnalysisOptionsResponse,
  SeriesAnalysisRecalculationAcceptedResponse: async () =>
    (await import("@/shared/api/generatedContracts/series-analysis-validators.generated"))
      .validateSeriesAnalysisRecalculationAcceptedResponse,
  SeriesAnalysisStatusResponse: async () =>
    (await import("@/shared/api/generatedContracts/series-analysis-validators.generated"))
      .validateSeriesAnalysisStatusResponse,
} satisfies Record<EnvelopeName, ContractValidatorLoader>;

function decodeEnvelope<K extends EnvelopeName>(
  name: K,
  value: unknown,
): Promise<EnvelopeResponseByName[K]> {
  return decodeSeriesAnalysisContract(
    `envelope:${name}`,
    name,
    envelopeValidatorLoaders[name],
    value,
  );
}

export function decodeSeriesAnalysisOptions(
  value: unknown,
): Promise<SeriesAnalysisOptionsResponse> {
  return decodeEnvelope("SeriesAnalysisOptionsResponse", value);
}

export function decodeSeriesAnalysisStatus(value: unknown): Promise<SeriesAnalysisStatusResponse> {
  return decodeEnvelope("SeriesAnalysisStatusResponse", value);
}

export function decodeSeriesAnalysisAdminOverview(
  value: unknown,
): Promise<SeriesAnalysisAdminOverview> {
  return decodeEnvelope("SeriesAnalysisAdminOverviewResponse", value);
}

export function decodeSeriesAnalysisRecalculationAccepted(
  value: unknown,
): Promise<SeriesAnalysisRecalculationAccepted> {
  return decodeEnvelope("SeriesAnalysisRecalculationAcceptedResponse", value);
}
