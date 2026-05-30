// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { useStorageValue } from "@/shared/lib/useStorageValue";

function StorageProbe() {
  const [value, setValue] = useStorageValue("momoresult.testStorage", {
    customEventName: "momoresult-test-storage-change",
  });

  return (
    <button type="button" onClick={() => setValue("next")}>
      {value || "empty"}
    </button>
  );
}

describe("useStorageValue", () => {
  it("treats blocked browser storage as unavailable", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });

    const user = userEvent.setup();
    render(<StorageProbe />);

    const button = screen.getByRole("button", { name: "empty" });
    await user.click(button);

    expect(button).toHaveTextContent("empty");
  });
});
