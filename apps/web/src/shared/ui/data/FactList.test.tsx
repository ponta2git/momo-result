import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FactList } from "@/shared/ui/data/FactList";

describe("FactList", () => {
  it("preserves term/value semantics in a segmented data layout", () => {
    render(
      <FactList
        ariaLabel="集計条件"
        columns={2}
        items={[
          { id: "matches", label: "対象試合", value: "24戦" },
          { id: "period", label: "期間", value: "2026年" },
        ]}
        layout="segmented"
      />,
    );

    const facts = screen.getByLabelText("集計条件");
    expect(within(facts).getAllByRole("term")).toHaveLength(2);
    expect(within(facts).getAllByRole("definition")).toHaveLength(2);
    expect(within(facts).getByText("対象試合")).toBeVisible();
    expect(within(facts).getByText("24戦")).toHaveClass("tabular-nums");
  });

  it("aligns compact label and value pairs on a shared text baseline", () => {
    render(
      <FactList
        ariaLabel="開催情報"
        items={[{ id: "owner", label: "オーナー", value: "ぽんた" }]}
        layout="inline"
      />,
    );

    const facts = screen.getByLabelText("開催情報");
    expect(facts.firstElementChild).toHaveClass("items-baseline");
    expect(within(facts).getByRole("definition")).not.toHaveClass("mt-0.5");
  });
});
