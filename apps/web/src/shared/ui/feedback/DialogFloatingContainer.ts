import { createContext, useContext } from "react";

/** The owning dialog's unclipped floating layer; null uses the page's normal portal. */
export const DialogFloatingContainerContext = createContext<HTMLElement | null>(null);

export function useDialogFloatingContainer() {
  return useContext(DialogFloatingContainerContext);
}
