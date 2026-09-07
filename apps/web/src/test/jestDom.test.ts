import { expect, expectTypeOf, it } from "vitest";

it("preserves DOM matcher results, failures, and async return types", async () => {
  const button = document.createElement("button");
  button.textContent = "Save changes";

  expectTypeOf(expect(button).toHaveTextContent(/Save/u)).toEqualTypeOf<void>();
  expectTypeOf(expect(button).not.toBeDisabled()).toEqualTypeOf<void>();
  expect(button).toHaveAccessibleName(expect.stringContaining("Save"));
  expect({ button }).toEqual({ button: expect.toHaveTextContent("Save") });
  expect(() => expect(button).toHaveTextContent("Cancel")).toThrow();

  const assertion = expect(Promise.resolve(button)).resolves.toHaveTextContent("Save");
  expectTypeOf(assertion).toEqualTypeOf<Promise<void>>();
  await assertion;
});
