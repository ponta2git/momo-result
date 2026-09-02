import { cn } from "@/shared/ui/cn";

type PlayOrder = 1 | 2 | 3 | 4;

export type PlayOrderPresentation = {
  color: string;
  label: string;
  playOrder: PlayOrder | null;
};

const presentations = {
  1: {
    color: "var(--color-play-order-1)",
    label: "プレー順1",
    playOrder: 1,
  },
  2: {
    color: "var(--color-play-order-2)",
    label: "プレー順2",
    playOrder: 2,
  },
  3: {
    color: "var(--color-play-order-3)",
    label: "プレー順3",
    playOrder: 3,
  },
  4: {
    color: "var(--color-play-order-4)",
    label: "プレー順4",
    playOrder: 4,
  },
} as const satisfies Record<PlayOrder, PlayOrderPresentation>;

const unknownPresentation: PlayOrderPresentation = {
  color: "var(--color-border-strong)",
  label: "プレー順不明",
  playOrder: null,
};

export function playOrderPresentation(playOrder: number | null | undefined): PlayOrderPresentation {
  if (playOrder === 1 || playOrder === 2 || playOrder === 3 || playOrder === 4) {
    return presentations[playOrder];
  }
  return unknownPresentation;
}

export function PlayOrderMark({
  align = "start",
  playOrder,
}: {
  align?: "start" | "center" | undefined;
  playOrder: number | null | undefined;
}) {
  const presentation = playOrderPresentation(playOrder);

  return (
    <span
      className={cn(
        "inline-flex min-w-0 items-center gap-2 text-xs font-semibold text-[var(--color-text-secondary)] tabular-nums",
        align === "center" ? "justify-center" : "",
      )}
      data-play-order={presentation.playOrder ?? "unknown"}
    >
      <span
        aria-hidden="true"
        className="size-3 shrink-0 rounded-full border border-[var(--color-border-strong)]"
        style={{ backgroundColor: presentation.color }}
      />
      <span>{presentation.label}</span>
    </span>
  );
}
