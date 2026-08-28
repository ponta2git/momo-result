import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  MemberSequenceLabel,
  memberSequencePresentation,
} from "@/shared/ui/data/MemberSequenceLabel";

describe("MemberSequenceLabel", () => {
  it("maps canonical members to the familiar four-player color order", () => {
    render(<MemberSequenceLabel memberId="member_akane_mami">あかねまみ</MemberSequenceLabel>);

    const label = screen.getByText("あかねまみ").parentElement;
    expect(label).toHaveAttribute("data-member-sequence", "3");
    expect(label?.querySelector('[aria-hidden="true"]')).toHaveStyle({
      backgroundColor: "var(--color-member-sequence-3)",
    });
    expect(memberSequencePresentation("unknown").sequence).toBeNull();
  });

  it("keeps the visible member identity neutral when play order owns the accent", () => {
    render(
      <MemberSequenceLabel accent={false} memberId="member_akane_mami">
        あかねまみ
      </MemberSequenceLabel>,
    );

    const label = screen.getByText("あかねまみ").parentElement;
    expect(label).toHaveAttribute("data-member-accent", "neutral");
    expect(label?.querySelector('[aria-hidden="true"]')).not.toBeInTheDocument();
  });
});
