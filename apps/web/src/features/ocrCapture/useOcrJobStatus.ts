import { useQuery } from "@tanstack/react-query";

import { getOcrJob } from "@/shared/api/ocrJobs";
import { ocrJobKeys } from "@/shared/api/queryKeys";

type UseOcrJobStatusInput = {
  jobId?: string | undefined;
};

/**
 * OCR ジョブの状態を、ジョブ ID の受領時と明示的な更新要求時にだけ取得する。
 *
 * React Query の通常の再取得トリガーもここで無効化し、タブ復帰・再接続・タイマーによって
 * バックグラウンド通信が発生しないことを、このリソース固有の契約として固定する。
 */
export function useOcrJobStatus({ jobId }: UseOcrJobStatusInput) {
  return useQuery({
    queryKey: ocrJobKeys.detail(jobId),
    queryFn: ({ signal }) => getOcrJob(jobId ?? "", { signal }),
    enabled: Boolean(jobId),
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
}
