import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RouteSuspenseFallback } from "@/app/RouteSuspenseFallback";

describe("RouteSuspenseFallback", () => {
  it("provides a usable root landmark while announcing initial preparation", () => {
    render(<RouteSuspenseFallback asMain pathname="/" />);

    const main = screen.getByRole("main");
    const status = screen.getByRole("status");
    expect(main).toHaveAttribute("id", "main-content");
    expect(main).toContainElement(status);
    expect(status).toHaveTextContent("読み込んでいます");
    expect(status.closest('[aria-busy="true"]')).toBeNull();
    main.focus();
    expect(main).toHaveFocus();
  });
});
