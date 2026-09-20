import { useActionState } from "react";

import { toConfirmMatchRequest } from "@/features/matches/workspace/matchFormToRequest";
import type { MatchFormValues } from "@/features/matches/workspace/matchFormTypes";

type ConfirmMutation = {
  mutateAsync: (request: ReturnType<typeof toConfirmMatchRequest>) => Promise<unknown>;
};

export function useMatchWorkspaceConfirmAction({
  confirmMutation,
  values,
}: {
  confirmMutation: ConfirmMutation;
  values: MatchFormValues;
}) {
  const [, action, pending] = useActionState<null, FormData>(async () => {
    const request = toConfirmMatchRequest(values);
    await confirmMutation.mutateAsync(request).catch(() => undefined);
    return null;
  }, null);

  return { action, pending };
}
