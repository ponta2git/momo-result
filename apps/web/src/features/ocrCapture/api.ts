import { apiRequest } from "@/shared/api/client";
import type { components } from "@/shared/api/generated";

export type UploadImageResponse = components["schemas"]["UploadImageResponse"];
export type CreateOcrJobRequest = components["schemas"]["CreateOcrJobRequest"];
export type CreateOcrJobResponse = components["schemas"]["CreateOcrJobResponse"];
export type OcrJobResponse = components["schemas"]["OcrJobResponse"];
export type OcrDraftResponse = components["schemas"]["OcrDraftResponse"];
export type CancelOcrJobResponse = components["schemas"]["CancelOcrJobResponse"];

export async function uploadImage(file: File): Promise<UploadImageResponse> {
  const formData = new FormData();
  formData.set("file", file);
  return apiRequest<UploadImageResponse>("/api/uploads/images", {
    method: "POST",
    formData,
  });
}

export async function createOcrJob(request: CreateOcrJobRequest): Promise<CreateOcrJobResponse> {
  return apiRequest<CreateOcrJobResponse>("/api/ocr-jobs", {
    method: "POST",
    body: request,
  });
}

export async function getOcrJob(jobId: string): Promise<OcrJobResponse> {
  return apiRequest<OcrJobResponse>(`/api/ocr-jobs/${encodeURIComponent(jobId)}`);
}

export async function getOcrDraft(draftId: string): Promise<OcrDraftResponse> {
  return apiRequest<OcrDraftResponse>(`/api/ocr-drafts/${encodeURIComponent(draftId)}`);
}

export async function cancelOcrJob(jobId: string): Promise<CancelOcrJobResponse> {
  return apiRequest<CancelOcrJobResponse>(`/api/ocr-jobs/${encodeURIComponent(jobId)}`, {
    method: "DELETE",
  });
}
