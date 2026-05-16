import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useActionState } from "react";

import { invalidateAdminAccountCaches } from "@/features/adminAccounts/adminAccountCache";
import { adminAccountsQueryKeys } from "@/features/adminAccounts/queryKeys";
import {
  createLoginAccount,
  listLoginAccounts,
  updateLoginAccount,
} from "@/shared/api/adminAccounts";
import type {
  CreateLoginAccountRequest,
  UpdateLoginAccountRequest,
} from "@/shared/api/adminAccounts";
import { runIdempotentMutation } from "@/shared/api/idempotency";
import { formatApiError, normalizeUnknownApiError } from "@/shared/api/problemDetails";
import { useIdempotencyKeyStore } from "@/shared/api/useIdempotencyKeyStore";

const initialCreateAccountState = { error: "", version: 0 };

export function useAdminAccountsPageController() {
  const queryClient = useQueryClient();
  const idempotencyKeys = useIdempotencyKeyStore();

  const accountsQuery = useQuery({
    queryKey: adminAccountsQueryKeys.all(),
    queryFn: listLoginAccounts,
  });

  const [createState, createAction] = useActionState<typeof initialCreateAccountState, FormData>(
    async (previous, formData) => {
      const playerMemberId = String(formData.get("playerMemberId") ?? "");
      const request: CreateLoginAccountRequest = {
        discordUserId: String(formData.get("discordUserId") ?? ""),
        displayName: String(formData.get("displayName") ?? ""),
        isAdmin: formData.get("isAdmin") === "on",
        loginEnabled: formData.get("loginEnabled") === "on",
        ...(playerMemberId ? { playerMemberId } : {}),
      };

      try {
        await runIdempotentMutation(
          idempotencyKeys,
          "adminAccounts.createLoginAccount",
          request,
          (options) => createLoginAccount(request, options),
        );
        await invalidateAdminAccountCaches(queryClient);
        return { error: "", version: previous.version + 1 };
      } catch (error) {
        return {
          error: formatApiError(error, "ログインアカウントの作成に失敗しました"),
          version: previous.version,
        };
      }
    },
    initialCreateAccountState,
  );

  const updateMutation = useMutation({
    mutationFn: ({
      accountId,
      request,
    }: {
      accountId: string;
      request: UpdateLoginAccountRequest;
    }) => updateLoginAccount(accountId, request),
    onSuccess: async () => {
      await invalidateAdminAccountCaches(queryClient);
    },
  });

  const error = updateMutation.error ?? accountsQuery.error;
  const normalizedError = error ? normalizeUnknownApiError(error) : undefined;

  return {
    accounts: accountsQuery.data?.items ?? [],
    createAction,
    createState,
    normalizedError,
    updateMutation,
  };
}
