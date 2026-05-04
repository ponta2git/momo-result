import { useCallback } from "react";

import { getBuildTimeDevUser } from "@/shared/api/client";
import { useStorageValue } from "@/shared/lib/useStorageValue";

const storageKey = "momoresult.devUser";
const eventName = "momoresult-dev-user-change";

export function useDevUser() {
  const buildTimeDevUser = getBuildTimeDevUser();
  const [devUser, setStoredDevUser] = useStorageValue(storageKey, {
    customEventName: eventName,
    overrideValue: buildTimeDevUser,
  });

  const setDevUser = useCallback(
    (value: string) => {
      setStoredDevUser(value);
    },
    [setStoredDevUser],
  );

  return {
    devUser,
    setDevUser,
    lockedByEnv: Boolean(buildTimeDevUser),
  };
}
