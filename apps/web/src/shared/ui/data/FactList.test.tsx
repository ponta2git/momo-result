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
});
