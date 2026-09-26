import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AuthPanel } from "@/shared/auth/AuthPanel";

function preventDocumentNavigation(event: MouseEvent) {
  event.preventDefault();
}

describe("AuthPanel", () => {
  it("keeps modified navigation available and restores a pending login after browser back", () => {
    vi.stubEnv("DEV", false);
    // Cancel jsdom navigation after React has handled the native click.
    document.addEventListener("click", preventDocumentNavigation);
    try {
      render(<AuthPanel auth={undefined} loginNextPath="/matches?status=confirmed" />);
      const link = screen.getByRole("link", { name: "Discordでログインする" });
      expect(link).toHaveAttribute(
        "href",
        "/api/auth/login?next=%2Fmatches%3Fstatus%3Dconfirmed&silent=1",
      );

      fireEvent.click(link, { metaKey: true });
      expect(link).not.toHaveAttribute("aria-busy");
      fireEvent.click(link, { ctrlKey: true });
      expect(link).not.toHaveAttribute("aria-busy");

      fireEvent.click(link);
      expect(screen.getByRole("link", { name: "Discordへ移動中…" })).toBe(link);
      expect(link).toHaveAttribute("aria-busy", "true");

      fireEvent(window, new PageTransitionEvent("pageshow", { persisted: true }));
      expect(screen.getByRole("link", { name: "Discordでログインする" })).toBe(link);
      expect(link).not.toHaveAttribute("aria-busy");
      expect(link).not.toHaveAttribute("aria-disabled", "true");
    } finally {
      document.removeEventListener("click", preventDocumentNavigation);
    }
  });
});
