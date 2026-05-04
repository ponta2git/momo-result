import { useQuery } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";

/**
 * id が `string | undefined` のときに自動で disable し、id が定義済みのときだけ
 * fetcher(id) を呼ぶ react-query ラッパ。
 *
 * `assertDefined(id, "...")` + `enabled: Boolean(id)` の二重記述を解消する。
 * fetcher の引数は `string`（非 undefined）に絞られるため、
 * `assertDefined` がなくても型検査で弾ける。
 *
 * 参照透過性: 同じ key/fetcher/id では常に同じクエリ結果を返す。
 */
export function useResourceQuery<TData>(args: {
  key: (id: string | undefined) => readonly unknown[];
  id: string | undefined;
  fetcher: (id: string) => Promise<TData>;
  enabled?: boolean;
}): UseQueryResult<TData> {
  const { key, id, fetcher, enabled = true } = args;
  return useQuery({
    queryKey: key(id),
    queryFn: () => {
      if (id === undefined) {
        throw new Error("useResourceQuery: id is undefined when queryFn invoked");
      }
      return fetcher(id);
    },
    enabled: enabled && id !== undefined,
  });
}
