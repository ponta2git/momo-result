import { expect, expectTypeOf } from "vitest";

/** Our Vitest 5 matcher augmentation preserves sync and async return types. Runtime use is
 * exercised by the component suites; testing jest-dom's own assertions here adds no evidence. */
export function verifyDomMatcherTypes(button: HTMLButtonElement): void {
  expectTypeOf(expect(button).toHaveTextContent(/Save/u)).toEqualTypeOf<void>();
  expectTypeOf(expect(button).not.toBeDisabled()).toEqualTypeOf<void>();
  expectTypeOf(expect(Promise.resolve(button)).resolves.toHaveTextContent("Save")).toEqualTypeOf<
    Promise<void>
  >();
}
