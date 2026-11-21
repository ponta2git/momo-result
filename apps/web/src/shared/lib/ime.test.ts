// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { isImeComposing } from "@/shared/lib/ime";

describe("isImeComposing", () => {
  it("treats a composing key and Safari's confirming keyCode 229 as composition", () => {
    expect(isImeComposing(new KeyboardEvent("keydown", { key: "Enter", isComposing: true }))).toBe(
      true,
    );
    expect(isImeComposing(new KeyboardEvent("keydown", { key: "Enter", keyCode: 229 }))).toBe(true);
    expect(isImeComposing(new KeyboardEvent("keydown", { key: "Enter" }))).toBe(false);
  });
});
