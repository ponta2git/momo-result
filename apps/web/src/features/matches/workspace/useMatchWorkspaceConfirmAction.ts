import { useActionState } from "react";

import { toConfirmMatchRequest } from "@/features/matches/workspace/matchFormToRequest";
import type { MatchFormValues } from "@/features/matches/workspace/matchFormTypes";

type ConfirmMutation = {
  mutateAsync: (request: ReturnType<typeof toConfirmMatchRequest>) => Promise<unknown>;
};

export function useMatchWorkspaceConfirmAction({
  confirmMutation,
  ensureDraftIsOpenForConfirm,
  values,
}: {
  confirmMutation: ConfirmMutation;
  ensureDraftIsOpenForConfirm: (draftId: string | undefined) => Promise<boolean>;
  values: MatchFormValues;
}) {
  const [, action, pending] = useActionState<null, FormData>(async () => {
    const request = toConfirmMatchRequest(values);
    const canConfirm = await ensureDraftIsOpenForConfirm(request.matchDraftId);
    if (!canConfirm) {
      return null;
    }

    await confirmMutation.mutateAsync(request).catch(() => undefined);
    return null;
  }, null);

  return { action, pending };
}
