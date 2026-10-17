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
import { normalizeOutlookPair } from "@/features/seriesComparison/model/seriesAnalysisViewModel";
import type { SeriesAnalysisSelection } from "@/features/seriesComparison/model/seriesAnalysisViewModel";
import { editOutlook } from "@/features/seriesComparison/outlook/outlookEditing";
import type { OutlookEdit } from "@/features/seriesComparison/outlook/outlookEditing";
import {
  adoptOutlookSummary,
  finishOutlookGesture,
} from "@/features/seriesComparison/outlook/outlookSession";
import type { OutlookSession } from "@/features/seriesComparison/outlook/outlookSession";
import type { SeriesAnalysisOutlookSummary } from "@/shared/api/seriesAnalysis";

type SessionStore = {
  read: () => OutlookSession | undefined;
  subscribe: (listener: () => void) => () => void;
  commit: (next: OutlookSession | undefined) => void;
};
function createSessionStore(): SessionStore {
  let value: OutlookSession | undefined;
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
const SessionContext = createContext<SessionStore | undefined>(undefined);

/** The complete pair and its history share one page lifetime and one atomic commit. */
export function OutlookSessionOwner({ children }: { children: ReactNode }) {
  const [store] = useState(createSessionStore);
  return <SessionContext value={store}>{children}</SessionContext>;
}
function usePageSessionStore() {
  const shared = useContext(SessionContext);
  const [local] = useState(createSessionStore);
  return shared ?? local;
}

/** Internal adapter port. Views consume the purpose-specific hooks, never this store. */
export function useOutlookInternalStore() {
  const store = useContext(SessionContext);
  if (!store) throw new Error("An Outlook workspace owner is required.");
  return store;
}

function acceptSummary(
  store: SessionStore,
  response: SeriesAnalysisOutlookSummary,
  scopeKey: string,
  memberIds: [string, string],
): SessionStore {
  let previous: OutlookSession | undefined;
  let value: OutlookSession | undefined;
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
export function OutlookWorkspaceOwner({
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
  const store = usePageSessionStore();
  const pair = normalizeOutlookPair(selection.focusMemberId, selection.rivalMemberId);
  const scopeKey = seriesAnalysisScopeSignature(selection);
  const accepted = useMemo(
    () => acceptSummary(store, response, scopeKey, [pair.focusMemberId, pair.rivalMemberId]),
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
    <SessionContext value={accepted}>
      <Fragment key={initial?.key}>{initial ? children : empty}</Fragment>
    </SessionContext>
  );
}

/** Page composition observes only the adoption gate, and supplies resolved comparison facts. */
export function useOutlookComparisonLifecycle(
  resolution: { kind: "pending" } | { kind: "empty" } | { kind: "ready"; comparisonKey: string },
) {
  const store = usePageSessionStore();
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

function projectionReader<T extends object>(
  store: SessionStore,
  select: (session: OutlookSession) => T,
) {
  let previous: T | undefined;
  let observed: OutlookSession | undefined;
  return () => {
    const session = store.read();
    if (!session) throw new Error("An accepted Outlook summary is required.");
    if (session === observed && previous) return previous;
    observed = session;
    const next = select(session);
    if (!previous || !sameFields(previous, next)) previous = next;
    return previous;
  };
}

/** Cache projections by their public fields, so unrelated edits preserve snapshot identity. */
export function useOutlookProjection<T extends object>(select: (session: OutlookSession) => T): T {
  const store = useOutlookInternalStore();
  const read = useMemo(() => projectionReader(store, select), [select, store]);
  return useSyncExternalStore(store.subscribe, read);
}

export function useOutlookEdit() {
  const store = useOutlookInternalStore();
  return useMemo(
    () => (intent: OutlookEdit) => {
      const current = store.read();
      if (current) store.commit(editOutlook(current, intent));
    },
    [store],
  );
}
