import { useCallback, useSyncExternalStore } from "react";

import { getBuildTimeDevUser } from "@/shared/api/client";

const storageKey = "momoresult.devUser";
const eventName = "momoresult-dev-user-change";

function emitChange() {
  window.dispatchEvent(new Event(eventName));
}

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(eventName, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(eventName, callback);
  };
}

function getSnapshot() {
  return getBuildTimeDevUser() ?? window.localStorage.getItem(storageKey) ?? "";
}

function getServerSnapshot() {
  return "";
}

export function useDevUser() {
  const devUser = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setDevUser = useCallback((value: string) => {
    if (getBuildTimeDevUser()) {
      return;
    }
    if (value) {
      window.localStorage.setItem(storageKey, value);
    } else {
      window.localStorage.removeItem(storageKey);
    }
    emitChange();
  }, []);

  return {
    devUser,
    setDevUser,
    lockedByEnv: Boolean(getBuildTimeDevUser()),
  };
}
