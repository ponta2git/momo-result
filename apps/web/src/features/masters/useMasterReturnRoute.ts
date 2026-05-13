import { useSearchParams } from "react-router-dom";

import {
  appendHandoffIdToReturnTo,
  inspectMasterHandoff,
  sanitizeReturnTo,
} from "@/shared/workflows/matchWorkspaceMasterHandoff";

export function useMasterReturnRoute() {
  const [searchParams] = useSearchParams();
  const rawReturnTo = searchParams.get("returnTo");
  const returnTo = sanitizeReturnTo(rawReturnTo);
  const hasInvalidReturnTo = Boolean(rawReturnTo && !returnTo);
  const handoffId = searchParams.get("handoffId");
  const handoffStatus = returnTo
    ? inspectMasterHandoff({ expectedReturnTo: returnTo, handoffId }).status
    : "missing";
  const returnDestination =
    returnTo && handoffStatus === "available" && handoffId
      ? appendHandoffIdToReturnTo(returnTo, handoffId)
      : returnTo;

  return {
    handoffStatus,
    hasInvalidReturnTo,
    returnDestination,
  };
}
