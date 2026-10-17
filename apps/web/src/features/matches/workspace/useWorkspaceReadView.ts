import { useSyncExternalStore } from "react";

import type { WorkspaceReadView } from "@/features/matches/workspace/matchWorkspaceEditingStore";

export function useWorkspaceReadView<T>(view: WorkspaceReadView<T>): T {
  return useSyncExternalStore(view.subscribe, view.getSnapshot, view.getSnapshot);
}
