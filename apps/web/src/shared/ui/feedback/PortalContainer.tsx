import { createContext, useCallback, useContext, useState } from "react";
import type { ReactNode } from "react";

const PortalContainerContext = createContext<HTMLElement | null>(null);

export function usePortalContainer() {
  return useContext(PortalContainerContext);
}

/** Keeps floating UI inside the DOM subtree hidden by its owning Activity. */
export function PortalContainer({ children }: { children: ReactNode }) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const attachContainer = useCallback((node: HTMLDivElement | null) => {
    // Activity disconnects refs while retaining the DOM. Keep that same portal host
    // instead of moving retained dialogs back to the visible document body.
    if (node) setContainer(node);
  }, []);

  return (
    <div className="contents" ref={attachContainer}>
      <PortalContainerContext value={container}>{children}</PortalContainerContext>
    </div>
  );
}
