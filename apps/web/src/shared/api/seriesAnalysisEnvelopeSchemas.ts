import type { components } from "@/shared/api/generated";
import type {
  SeriesAnalysisAdminOverview,
  SeriesAnalysisRecalculationAccepted,
} from "@/shared/api/seriesAnalysisAdminTypes";
import { decodeSeriesAnalysisContract } from "@/shared/api/seriesAnalysisContractDecoder";
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

async function envelopeSchema(name: EnvelopeName): Promise<unknown> {
  const document = (
    await import("@/shared/api/generatedContracts/series-analysis-envelope.schema.generated.json")
  ).default;
  return { ...document, $ref: `#/$defs/${name}` };
}

function decodeEnvelope<K extends EnvelopeName>(
  name: K,
  value: unknown,
): Promise<EnvelopeResponseByName[K]> {
  return decodeSeriesAnalysisContract(`envelope:${name}`, name, () => envelopeSchema(name), value);
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
