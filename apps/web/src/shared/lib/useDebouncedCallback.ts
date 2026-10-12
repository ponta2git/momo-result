import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";

/** A trailing callback. Callers own validity and cancel when their work context changes. */
export function useDebouncedCallback<T>(callback: (value: T) => void, delayMs: number) {
  const callbackRef = useRef(callback);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useLayoutEffect(() => {
    callbackRef.current = callback;
  }, [callback]);
  const cancel = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
  }, []);
  const schedule = useCallback(
    (value: T) => {
      cancel();
      timer.current = setTimeout(() => {
        timer.current = undefined;
        callbackRef.current(value);
      }, delayMs);
    },
    [cancel, delayMs],
  );
  useEffect(() => cancel, [cancel]);
  return useMemo(() => ({ schedule, cancel }), [schedule, cancel]);
}
