import { useCallback, useSyncExternalStore } from "react";

type StorageArea = "local" | "session";

function getStorage(area: StorageArea): Storage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return area === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return undefined;
  }
}

function readStorageValue(area: StorageArea, key: string): string {
  try {
    return getStorage(area)?.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function writeStorageValue(area: StorageArea, key: string, value: string): boolean {
  const storage = getStorage(area);
  if (!storage) {
    return false;
  }
  try {
    if (value) {
      storage.setItem(key, value);
    } else {
      storage.removeItem(key);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * `Storage` 上の文字列値を `useSyncExternalStore` 経由で購読する。
 *
 * - `storage` event でクロスタブ更新を反映する
 * - 同一タブ内の更新は `customEventName` を介してブロードキャストする
 * - SSR / 非対応環境では初期値として空文字を返す
 */
export function useStorageValue(
  key: string,
  options: {
    area?: StorageArea;
    customEventName: string;
    /** 環境変数等の優先値。truthy の間は localStorage 値を上書きする。 */
    overrideValue?: string | undefined;
  },
): readonly [string, (value: string) => void] {
  const area: StorageArea = options.area ?? "local";
  const { customEventName, overrideValue } = options;

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (typeof window === "undefined") return () => {};
      window.addEventListener("storage", onStoreChange);
      window.addEventListener(customEventName, onStoreChange);
      return () => {
        window.removeEventListener("storage", onStoreChange);
        window.removeEventListener(customEventName, onStoreChange);
      };
    },
    [customEventName],
  );

  const getSnapshot = useCallback(() => {
    if (overrideValue) return overrideValue;
    return readStorageValue(area, key);
  }, [area, key, overrideValue]);

  const getServerSnapshot = useCallback(() => overrideValue ?? "", [overrideValue]);

  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setValue = useCallback(
    (next: string) => {
      if (overrideValue) return;
      if (writeStorageValue(area, key, next)) {
        window.dispatchEvent(new Event(customEventName));
      }
    },
    [area, customEventName, key, overrideValue],
  );

  return [value, setValue] as const;
}
