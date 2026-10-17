import {
  createContext,
  Fragment,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";

import { seriesAnalysisScopeSignature } from "@/features/seriesComparison/model/seriesAnalysisDisplayBundle";
import { normalizeOutlookPair } from "@/features/seriesComparison/model/seriesAnalysisSelection";
import type { SeriesAnalysisSelection } from "@/features/seriesComparison/model/seriesAnalysisSelection";
import { editOutlook } from "@/features/seriesComparison/outlook/outlookEditing";
import type { OutlookEdit } from "@/features/seriesComparison/outlook/outlookEditing";
import {
  adoptOutlookSummary,
  finishOutlookGesture,
} from "@/features/seriesComparison/outlook/outlookWorkspaceState";
import type { OutlookWorkspaceState } from "@/features/seriesComparison/outlook/outlookWorkspaceState";
import type { SeriesAnalysisOutlookSummary } from "@/shared/api/seriesAnalysis";

type OutlookWorkspaceStore = {
  read: () => OutlookWorkspaceState | undefined;
  subscribe: (listener: () => void) => () => void;
  commit: (next: OutlookWorkspaceState | undefined) => void;
};
function createOutlookWorkspaceStore(): OutlookWorkspaceStore {
  let value: OutlookWorkspaceState | undefined;
  const listeners = new Set<() => void>();
  return {
    read: () => value,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    commit: (next) => {
      if (next === value) return;
      value = next;
      listeners.forEach((listener) => listener());
    },
  };
}
const OutlookWorkspaceContext = createContext<OutlookWorkspaceStore | undefined>(undefined);

/** The complete pair and its history share one page lifetime and one atomic commit. */
export function OutlookWorkspaceProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createOutlookWorkspaceStore);
  return <OutlookWorkspaceContext value={store}>{children}</OutlookWorkspaceContext>;
}
function usePageWorkspaceStore() {
  const shared = useContext(OutlookWorkspaceContext);
  const [local] = useState(createOutlookWorkspaceStore);
  return shared ?? local;
}

/** Internal adapter port. Views consume the purpose-specific hooks, never this store. */
export function useOutlookWorkspaceStore() {
  const store = useContext(OutlookWorkspaceContext);
  if (!store) throw new Error("An Outlook workspace provider is required.");
  return store;
}

function createSummaryStore(
  store: OutlookWorkspaceStore,
  response: SeriesAnalysisOutlookSummary,
  scopeKey: string,
  memberIds: [string, string],
): OutlookWorkspaceStore {
  let previous: OutlookWorkspaceState | undefined;
  let value: OutlookWorkspaceState | undefined;
  let initialized = false;
  return {
    ...store,
    read: () => {
      const current = store.read();
      if (!initialized || current !== previous) {
        initialized = true;
        previous = current;
        value = adoptOutlookSummary(current, response, scopeKey, [memberIds[0], memberIds[1]]);
      }
      return value;
    },
  };
}

/** Resolve the current accepted summary before exposing any editing view. */
export function OutlookSummaryBoundary({
  response,
  selection,
  children,
  empty,
}: {
  response: SeriesAnalysisOutlookSummary;
  selection: SeriesAnalysisSelection;
  children: ReactNode;
  empty: ReactNode;
}) {
  const store = usePageWorkspaceStore();
  const pair = normalizeOutlookPair(selection.focusMemberId, selection.rivalMemberId);
  const scopeKey = seriesAnalysisScopeSignature(selection);
  const accepted = useMemo(
    () => createSummaryStore(store, response, scopeKey, [pair.focusMemberId, pair.rivalMemberId]),
    [store, response, scopeKey, pair.focusMemberId, pair.rivalMemberId],
  );
  const initial = accepted.read();
  useLayoutEffect(() => {
    store.commit(accepted.read());
  }, [accepted, store]);
  useEffect(
    () => () => {
      const current = store.read();
      if (current) store.commit(finishOutlookGesture(current));
    },
    [store],
  );
  return (
    <OutlookWorkspaceContext value={accepted}>
      <Fragment key={initial?.key}>{initial ? children : empty}</Fragment>
    </OutlookWorkspaceContext>
  );
}

/** Page composition observes only the adoption gate, and supplies resolved comparison facts. */
export function useOutlookComparisonLifecycle(
  resolution: { kind: "pending" } | { kind: "empty" } | { kind: "ready"; comparisonKey: string },
) {
  const store = usePageWorkspaceStore();
  const deferred = useSyncExternalStore(store.subscribe, () => Boolean(store.read()?.gesture));
  useEffect(() => {
    if (resolution.kind === "pending") return;
    const current = store.read();
    const key = resolution.kind === "ready" ? resolution.comparisonKey : undefined;
    if (current?.key !== key) store.commit(undefined);
  }, [resolution, store]);
  return deferred;
}

function sameFields<T extends object>(left: T, right: T) {
  const keys = Object.keys(left) as Array<keyof T>;
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => Object.is(left[key], right[key]))
  );
}

function createProjectionReader<T extends object>(
  store: OutlookWorkspaceStore,
  select: (state: OutlookWorkspaceState) => T,
) {
  let previous: T | undefined;
  let observed: OutlookWorkspaceState | undefined;
  return () => {
    const state = store.read();
    if (!state) throw new Error("An accepted Outlook summary is required.");
    if (state === observed && previous) return previous;
    observed = state;
    const next = select(state);
    if (!previous || !sameFields(previous, next)) previous = next;
    return previous;
  };
}

/** Cache projections by their public fields, so unrelated edits preserve snapshot identity. */
export function useOutlookProjection<T extends object>(
  select: (state: OutlookWorkspaceState) => T,
): T {
  const store = useOutlookWorkspaceStore();
  const read = useMemo(() => createProjectionReader(store, select), [select, store]);
  return useSyncExternalStore(store.subscribe, read);
}

export function useOutlookEdit() {
  const store = useOutlookWorkspaceStore();
  return useMemo(
    () => (intent: OutlookEdit) => {
      const current = store.read();
      if (current) store.commit(editOutlook(current, intent));
    },
    [store],
  );
}
