import { apiRequest } from "@/shared/api/client";
import type { components } from "@/shared/api/generated";

export type PutOcrSubmissionRequest = components["schemas"]["PutOcrSubmissionRequest"];
export type OcrSubmissionResponse = components["schemas"]["OcrSubmissionResponse"];

/** The URL is the operation identity; retrying PUT preserves the fixed image set. */
export function putOcrSubmission(
  submissionId: string,
  request: PutOcrSubmissionRequest,
): Promise<OcrSubmissionResponse> {
  return apiRequest<OcrSubmissionResponse>(
    `/api/ocr-submissions/${encodeURIComponent(submissionId)}`,
    { method: "PUT", body: request },
  );
}
