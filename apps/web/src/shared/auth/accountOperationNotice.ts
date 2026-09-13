import { useSyncExternalStore } from "react";

// Only this confirmed operation crosses the auth boundary; ordinary toasts never do.
let disabledAccountId: string | undefined;
const listeners = new Set<() => void>();

export function reportSelfAccountDisabled(accountId: string) {
  disabledAccountId = accountId;
  listeners.forEach((listener) => listener());
}

export function clearAccountOperationNotice() {
  disabledAccountId = undefined;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSelfAccountDisabledNotice() {
  return (
    useSyncExternalStore(
      subscribe,
      () => disabledAccountId,
      () => undefined,
    ) !== undefined
  );
}
