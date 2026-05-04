import { useEffect, useRef } from "react";

/**
 * `marker` が変わったときだけ副作用を1回実行する。
 * ポーリング/ストリーミングで同じレスポンスが繰り返し届くケースなど、
 * 「同じ状態 (= 同じ marker) なら何もしない」を局所化したいときに使う。
 *
 * `marker` が `null` の間は何もしない。`effect` は最新クロージャで実行される
 * （レンダーごとに ref で差し替えられるため）ので、deps を指定する必要はない。
 */
export function useDistinctMarkerEffect(marker: string | null, effect: () => void): void {
  const effectRef = useRef(effect);
  effectRef.current = effect;
  const lastMarkerRef = useRef<string | null>(null);

  useEffect(() => {
    if (marker === null) {
      return;
    }
    if (lastMarkerRef.current === marker) {
      return;
    }
    lastMarkerRef.current = marker;
    effectRef.current();
  }, [marker]);
}
