/**
 * オブジェクトから値が `undefined` のプロパティを取り除く。
 *
 * `exactOptionalPropertyTypes: true` 環境で頻出する
 * `{ ...base, ...(cond ? { x: y } : {}) }` の散在を避けるためのユーティリティ。
 *
 * 型レベルでは:
 * - 入力で `undefined` を含まないキーはそのまま required
 * - 入力で `undefined` を含むキーは optional になり、値型から `undefined` が除去される
 *
 * @example
 *   compact({ a: 1, b: undefined as string | undefined })
 *   // 推論結果: { a: number; b?: string }
 */
type Compact<T> = {
  [K in keyof T as undefined extends T[K] ? never : K]: T[K];
} & {
  [K in keyof T as undefined extends T[K] ? K : never]?: Exclude<T[K], undefined>;
};

export function compact<T extends Record<string, unknown>>(obj: T): Compact<T> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result as Compact<T>;
}
