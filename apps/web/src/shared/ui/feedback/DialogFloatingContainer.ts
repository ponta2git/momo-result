import { createContext, useContext } from "react";

import { usePortalContainer } from "@/shared/ui/feedback/PortalContainer";

/** The owning dialog's unclipped floating layer; null uses the page's normal portal. */
export const DialogFloatingContainerContext = createContext<HTMLElement | null>(null);

export function useDialogFloatingContainer() {
  const dialogContainer = useContext(DialogFloatingContainerContext);
  const pageContainer = usePortalContainer();
  return dialogContainer ?? pageContainer;
}
