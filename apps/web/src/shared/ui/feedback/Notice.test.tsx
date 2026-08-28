import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Notice } from "@/shared/ui/feedback/Notice";

describe("Notice", () => {
  it("announces danger feedback immediately", () => {
    render(<Notice tone="danger">保存できませんでした。</Notice>);

    expect(screen.getByRole("alert")).toHaveTextContent("保存できませんでした。");
  });
});
