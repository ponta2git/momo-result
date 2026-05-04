import { useQuery } from "@tanstack/react-query";

import { getOcrJob } from "@/features/ocrCapture/api";
import { isTerminalJobStatus } from "@/shared/api/enums";
import { ocrJobKeys } from "@/shared/api/queryKeys";

export const maxPollAttempts = 15;
export const pollIntervalMs = 2_000;

type UseOcrJobPollingInput = {
  jobId?: string | undefined;
  attempts: number;
};

export function useOcrJobPolling({ jobId, attempts }: UseOcrJobPollingInput) {
  return useQuery({
    queryKey: ocrJobKeys.detail(jobId),
    queryFn: () => getOcrJob(jobId ?? ""),
    enabled: Boolean(jobId) && attempts < maxPollAttempts,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (!jobId || attempts >= maxPollAttempts || isTerminalJobStatus(status)) {
        return false;
      }
      return pollIntervalMs;
    },
  });
}
