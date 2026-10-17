import { useEffect, useEffectEvent, useLayoutEffect, useRef } from "react";

import { isAnalysisArtifactExpired } from "@/shared/api/problemDetails";

/** Rechecks publication and retries an expired resource once while that selection is active. */
export function useAnalysisArtifactRecovery({
  artifactId,
  error,
  resourceId,
  refreshResource,
  refreshPublication,
}: {
  artifactId: string | undefined;
  error: unknown;
  resourceId: string;
  refreshResource: () => Promise<void>;
  refreshPublication: () => Promise<string | undefined>;
}) {
  const handledResources = useRef(new Set<string>());
  const mounted = useRef(false);

  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // A refresh may settle after the selection changes. Consult the committed resource
  // before retrying, so an old publication read cannot restart another scope or an unmounted owner.
  const retryCurrentResource = useEffectEvent(
    (
      requestedResourceId: string,
      requestedArtifactId: string,
      publishedArtifactId: string | undefined,
    ) => {
      if (
        mounted.current &&
        requestedResourceId === resourceId &&
        publishedArtifactId === requestedArtifactId
      ) {
        return refreshResource();
      }
      return undefined;
    },
  );

  useEffect(() => {
    if (
      !artifactId ||
      !isAnalysisArtifactExpired(error) ||
      handledResources.current.has(resourceId)
    ) {
      return;
    }
    handledResources.current.add(resourceId);
    // The read adapter shares an in-flight publication check across expired resources.
    void refreshPublication()
      .then((publishedArtifactId) =>
        retryCurrentResource(resourceId, artifactId, publishedArtifactId),
      )
      .catch(() => {
        // The read adapter retains the error for the consumer's explicit retry.
      });
  }, [artifactId, error, refreshPublication, resourceId]);
}
