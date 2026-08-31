import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { MatchNoteField } from "@/features/matches/workspace/MatchNoteField";

function Harness() {
  const [value, setValue] = useState("");
  return <MatchNoteField error={false} value={value} onChange={setValue} />;
}

describe("MatchNoteField", () => {
  it("keeps over-limit pasted text and reports Unicode code-point count before save", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    expect(screen.getByRole("region", { name: "試合メモ（任意）" })).toBeInTheDocument();
    const textarea = screen.getByRole("textbox", { name: "試合メモ（任意）" });
    await user.click(textarea);
    await user.paste("🍑".repeat(151));

    expect(textarea).toHaveValue("🍑".repeat(151));
    expect(screen.getByText("151 / 150")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("150字以内");
  });
});
