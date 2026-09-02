import type { ReactNode } from "react";

import { memberSequence } from "@/shared/domain/members";

export type MemberSequencePresentation = {
  color: string;
  sequence: 1 | 2 | 3 | 4 | null;
};

export function memberSequencePresentation(memberId: string): MemberSequencePresentation {
  const sequence = memberSequence(memberId);
  return {
    color:
      sequence === null ? "var(--color-border-strong)" : `var(--color-member-sequence-${sequence})`,
    sequence,
  };
}

/**
 * Pairs a fixed member's visible name with the canonical blue→red→yellow→green
 * scan accent. When play order owns that palette in the same comparison, callers
 * keep the member label neutral and retain the explicit visible name.
 */
export function MemberSequenceLabel({
  accent = true,
  children,
  memberId,
}: {
  accent?: boolean | undefined;
  children: ReactNode;
  memberId: string;
}) {
  const presentation = memberSequencePresentation(memberId);

  return (
    <span
      className="inline-flex min-w-0 items-center gap-2"
      data-member-accent={accent ? "visible" : "neutral"}
      data-member-sequence={presentation.sequence ?? "unknown"}
    >
      {accent ? (
        <span
          aria-hidden="true"
          className="h-5 w-1 shrink-0 rounded-full"
          style={{ backgroundColor: presentation.color }}
        />
      ) : null}
      <span className="min-w-0">{children}</span>
    </span>
  );
}
