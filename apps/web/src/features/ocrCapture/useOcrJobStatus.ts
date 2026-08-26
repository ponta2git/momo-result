import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { getOcrJob } from "@/shared/api/ocrJobs";
import { ocrJobKeys } from "@/shared/api/queryKeys";

type UseOcrJobStatusInput = {
  jobId?: string | undefined;
  refreshRequest?: number | undefined;
};

/**
 * OCR ジョブの状態を、ジョブ ID の受領時と明示的な更新要求時にだけ取得する。
 *
 * React Query の通常の再取得トリガーもここで無効化し、タブ復帰・再接続・タイマーによって
 * バックグラウンド通信が発生しないことを、このリソース固有の契約として固定する。
 */
export function useOcrJobStatus({ jobId, refreshRequest }: UseOcrJobStatusInput) {
  const lastRequestRef = useRef({ jobId, refreshRequest });
  const query = useQuery({
    queryKey: ocrJobKeys.detail(jobId),
    queryFn: ({ signal }) => getOcrJob(jobId ?? "", { signal }),
    enabled: Boolean(jobId),
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });

  const refetch = query.refetch;
  useEffect(() => {
    const previous = lastRequestRef.current;
    lastRequestRef.current = { jobId, refreshRequest };

    if (!jobId || previous.jobId !== jobId || previous.refreshRequest === refreshRequest) {
      return;
    }

    void refetch();
  }, [jobId, refetch, refreshRequest]);

  return query;
}
