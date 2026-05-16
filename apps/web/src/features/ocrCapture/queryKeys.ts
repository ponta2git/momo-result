export const ocrJobKeys = {
  all: () => ["ocr-job"] as const,
  detail: (jobId: string | undefined) => ["ocr-job", jobId] as const,
};
