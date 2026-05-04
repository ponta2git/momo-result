import { useSuspenseQuery } from "@tanstack/react-query";
import type { UseSuspenseQueryResult } from "@tanstack/react-query";

import { assertDefined } from "@/shared/lib/invariant";

/**
 * Suspense 対応版 `useResourceQuery`。id が `string | undefined` のとき、
 * id が定義済みであることを `assertDefined` で保証してから `useSuspenseQuery` を呼ぶ。
 *
 * 想定: ルートガード or 親コンポーネントで id 確定後にレンダリングされる位置で使う。
 * id が undefined のままここに到達した場合は描画前提が崩れているので throw する。
 */
export function useResourceSuspenseQuery<TData>(args: {
  key: (id: string) => readonly unknown[];
  id: string | undefined;
  fetcher: (id: string) => Promise<TData>;
}): UseSuspenseQueryResult<TData> {
  const { key, id, fetcher } = args;
  assertDefined(id, "useResourceSuspenseQuery.id");
  return useSuspenseQuery({
    queryKey: key(id),
    queryFn: () => fetcher(id),
  });
}
