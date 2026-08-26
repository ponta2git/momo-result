import { useCallback } from "react";

import {
  devUserStorageKey,
  getBuildTimeDevUser,
  noDevUserSelectedValue,
} from "@/shared/api/client";
import { useStorageValue } from "@/shared/lib/useStorageValue";

const eventName = "momoresult-dev-user-change";

export function useDevUser() {
  const buildTimeDevUser = getBuildTimeDevUser();
  const [storedDevUser, setStoredDevUser] = useStorageValue(devUserStorageKey, {
    customEventName: eventName,
  });
  const devUser =
    storedDevUser === noDevUserSelectedValue ? "" : storedDevUser || buildTimeDevUser || "";

  const setDevUser = useCallback(
    (value: string) => {
      setStoredDevUser(value || noDevUserSelectedValue);
    },
    [setStoredDevUser],
  );

  return {
    devUser,
    setDevUser,
  };
}
