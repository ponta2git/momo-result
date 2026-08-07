import { useLocation } from "react-router-dom";

import { currentInternalLocation } from "@/shared/navigation/returnTo";

export function useCurrentLocationPath(): string {
  return currentInternalLocation(useLocation());
}
