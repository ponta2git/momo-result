import { useActionState } from "react";

import { toConfirmMatchRequest } from "@/features/matches/workspace/matchFormToRequest";
import type { MatchFormValues } from "@/features/matches/workspace/matchFormTypes";

export function useMatchWorkspaceConfirmAction({
  confirm,
  readLatestValues,
}: {
  confirm: (request: ReturnType<typeof toConfirmMatchRequest>) => Promise<void>;
  readLatestValues: () => MatchFormValues;
}) {
  const [, action, pending] = useActionState<null, FormData>(async () => {
    const request = toConfirmMatchRequest(readLatestValues());
    await confirm(request).catch(() => undefined);
    return null;
  }, null);

  return { action, pending };
}
