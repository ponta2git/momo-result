/**
 * Runtime invariant helper that narrows a value's type.
 *
 * Use this when control flow guarantees a value is defined, but TypeScript cannot
 * infer the narrowing (e.g. inside a TanStack Query `queryFn` that is gated by
 * `enabled`). Avoid the non-null assertion operator (`!`); prefer this so that
 * an unexpected `undefined`/`null` produces an actionable error instead of a
 * silent crash deeper in the call stack.
 */
export function assertDefined<T>(value: T | null | undefined, name: string): asserts value is T {
  if (value === null || value === undefined) {
    throw new Error(`Expected "${name}" to be defined.`);
  }
}
