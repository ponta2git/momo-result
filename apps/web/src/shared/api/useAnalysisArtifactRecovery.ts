import { hashKey } from "@tanstack/react-query";
import type { QueryKey } from "@tanstack/react-query";
import { useEffect, useEffectEvent, useRef } from "react";

import { isAnalysisArtifactExpired } from "@/shared/api/problemDetails";
import type { SeriesAnalysisStatusResponse } from "@/shared/api/seriesAnalysis";

type StatusResult = { data: SeriesAnalysisStatusResponse | undefined };

/** Rechecks publication and retries an expired resource once while that exact query is active. */
export function useAnalysisArtifactRecovery({
  artifactId,
  error,
  queryKey,
  refetchArtifact,
  refetchStatus,
}: {
  artifactId: string | undefined;
  error: unknown;
  queryKey: QueryKey;
  refetchArtifact: () => Promise<unknown>;
  refetchStatus: (options: { cancelRefetch: false }) => Promise<StatusResult>;
}) {
  const resourceKey = hashKey(queryKey);
  const handledResources = useRef(new Set<string>());
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Query observers retain refetch identity when their key changes. Read the committed selection
  // before using it, so an old status request cannot start work for another scope or after unmount.
  const retryCurrentResource = useEffectEvent(
    (requestedKey: string, requestedArtifactId: string, result: StatusResult) => {
      if (
        mounted.current &&
        requestedKey === resourceKey &&
        result.data?.currentArtifact?.artifactId === requestedArtifactId
      ) {
        return refetchArtifact();
      }
      return undefined;
    },
  );

  useEffect(() => {
    if (
      !artifactId ||
      !isAnalysisArtifactExpired(error) ||
      handledResources.current.has(resourceKey)
    ) {
      return;
    }
    handledResources.current.add(resourceKey);
    // Active analysis and match context can expire together; share their in-flight status read.
    void refetchStatus({ cancelRefetch: false }).then((result) =>
      retryCurrentResource(resourceKey, artifactId, result),
    );
  }, [artifactId, error, refetchStatus, resourceKey]);
}
