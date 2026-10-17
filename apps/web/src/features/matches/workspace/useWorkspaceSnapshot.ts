import { useSyncExternalStore } from "react";

import type { WorkspaceSubscription } from "@/features/matches/workspace/matchWorkspaceEditingStore";

export function useWorkspaceSnapshot<T>(subscription: WorkspaceSubscription<T>): T {
  return useSyncExternalStore(
    subscription.subscribe,
    subscription.getSnapshot,
    subscription.getSnapshot,
  );
}
