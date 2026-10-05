import { createContext, useContext, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";

import type { OutlookSession } from "@/features/seriesComparison/outlook/outlookSession";

/** Only one comparison's temporary edits survive route changes. No fetching or calculation lives here. */
function createSessionStore() {
  let value: OutlookSession | undefined;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => value,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    update: (change: (current: OutlookSession | undefined) => OutlookSession | undefined) => {
      const next = change(value);
      if (next === value) return;
      value = next;
      listeners.forEach((listener) => listener());
    },
  };
}

const OutlookSessionContext = createContext<ReturnType<typeof createSessionStore> | undefined>(
  undefined,
);

export function OutlookSessionOwner({ children }: { children: ReactNode }) {
  const [store] = useState(createSessionStore);
  return <OutlookSessionContext value={store}>{children}</OutlookSessionContext>;
}

export function OutlookSessionBoundary({ children }: { children: ReactNode }) {
  return useContext(OutlookSessionContext) ? (
    children
  ) : (
    <OutlookSessionOwner>{children}</OutlookSessionOwner>
  );
}

export function useOutlookSessionStore() {
  const shared = useContext(OutlookSessionContext);
  const [local] = useState(createSessionStore);
  return shared ?? local;
}

export function useOutlookSession() {
  const store = useOutlookSessionStore();
  return { store, session: useSyncExternalStore(store.subscribe, store.getSnapshot) };
}
