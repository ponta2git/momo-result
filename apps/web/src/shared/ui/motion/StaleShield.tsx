import { useLayoutEffect, useRef } from "react";
import type { ReactNode } from "react";

import { SpinnerIcon } from "@/shared/ui/feedback/Spinner";

type StaleShieldProps = {
  active: boolean;
  busyLabel?: string | undefined;
  children: ReactNode;
  fallback: ReactNode;
  statusPlacement?: "top-center" | "top-end" | undefined;
  strategy?: "preserve-inert" | "preserve-interactive" | "replace" | undefined;
};

/**
 * Distinguishes replacement loading from preserved content. Preserved content is only
 * inert when the caller knows the rendered scope no longer matches the requested scope.
 */
export function StaleShield({
  active,
  busyLabel = "表示を更新中",
  children,
  fallback,
  statusPlacement = "top-center",
  strategy = "replace",
}: StaleShieldProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const focusToRestoreRef = useRef<HTMLElement | null>(null);
  const interactionBlocked = strategy === "preserve-inert" && active;

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content || strategy === "replace") return;

    if (interactionBlocked) {
      const activeElement = content.ownerDocument.activeElement;
      focusToRestoreRef.current =
        activeElement instanceof HTMLElement && content.contains(activeElement)
          ? activeElement
          : null;
      content.toggleAttribute("inert", true);
      return;
    }

    content.toggleAttribute("inert", false);
    const focusToRestore = focusToRestoreRef.current;
    focusToRestoreRef.current = null;
    if (!focusToRestore?.isConnected) return;

    const activeElement = content.ownerDocument.activeElement;
    const focusWasDropped =
      activeElement === content.ownerDocument.body ||
      activeElement === content.ownerDocument.documentElement;
    if (focusWasDropped) {
      focusToRestore.focus({ preventScroll: true });
    }
  }, [interactionBlocked, strategy]);

  if (strategy !== "replace") {
    return (
      <div
        aria-busy={active || undefined}
        className="relative grid min-h-0 min-w-0"
        data-stale={active || undefined}
      >
        <div
          className={`grid min-h-0 min-w-0 ${active ? "opacity-60 blur-[0.5px]" : "opacity-100"}`}
          ref={contentRef}
        >
          {children}
        </div>
        {active ? (
          <div
            className={`pointer-events-none absolute inset-x-0 flex ${
              statusPlacement === "top-end" ? "top-0 justify-end" : "top-3 justify-center"
            }`}
          >
            <span
              className="inline-flex min-h-8 items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-xs font-semibold text-[var(--color-text-muted)]"
              role="status"
            >
              <SpinnerIcon size="sm" />
              {busyLabel}
            </span>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div aria-busy={active || undefined} className="grid min-h-0 min-w-0">
      {active ? (
        <div key="shield" className="grid min-h-0 min-w-0">
          {fallback}
        </div>
      ) : (
        <div key="content" className="grid min-h-0 min-w-0">
          {children}
        </div>
      )}
    </div>
  );
}
