import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useMemo, useSyncExternalStore } from "react";

import { SourceImageResource } from "@/features/matches/workspace/sourceImages/sourceImageResource";
import type {
  SourceImageItem,
  SourceImageKind,
} from "@/features/matches/workspace/sourceImages/sourceImageTypes";

export function useSourceImageResource({
  accountId,
  matchDraftId,
  loading,
  activeKind,
  sourceImages,
}: {
  accountId: string | undefined;
  matchDraftId: string;
  loading: boolean;
  activeKind: SourceImageKind;
  sourceImages: SourceImageItem[] | undefined;
}) {
  const client = useQueryClient();
  const scope = useId();
  const resource = useMemo(
    () => new SourceImageResource(client, matchDraftId, accountId, scope),
    [client, matchDraftId, accountId, scope],
  );
  const images = useSyncExternalStore(resource.subscribe, resource.getSnapshot);
  const snapshot = images[activeKind];
  useEffect(() => resource.connect(), [resource]);
  useEffect(() => {
    resource.update(loading, activeKind, sourceImages);
  }, [resource, loading, activeKind, sourceImages]);

  const descriptor = sourceImages?.find((item) => item.kind === activeKind);
  const isCurrent =
    snapshot?.descriptor?.imageUrl === descriptor?.imageUrl &&
    snapshot?.descriptor?.createdAt === descriptor?.createdAt &&
    snapshot?.descriptor?.contentType === descriptor?.contentType;

  return {
    activeImage: isCurrent ? snapshot : undefined,
    displayUrl: isCurrent ? snapshot?.displayUrl : undefined,
    handleActiveImageRetry: resource.retry,
  };
}
