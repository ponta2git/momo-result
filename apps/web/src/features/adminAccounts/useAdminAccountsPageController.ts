import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useActionState } from "react";

import { invalidateAdminAccountCaches } from "@/features/adminAccounts/adminAccountCache";
import { createLoginAccount, updateLoginAccount } from "@/shared/api/adminAccounts";
import type {
  CreateLoginAccountRequest,
  UpdateLoginAccountRequest,
} from "@/shared/api/adminAccounts";
import { runIdempotentMutation } from "@/shared/api/idempotency";
import { formatApiError, normalizeUnknownApiError } from "@/shared/api/problemDetails";
import {
  isInitialQueryLoading,
  shouldShowBlockingQueryError,
  shouldShowQueryError,
} from "@/shared/api/queryErrorState";
import { adminLoginAccountsQueryOptions } from "@/shared/api/queryOptions";
import { useIdempotencyKeyStore } from "@/shared/api/useIdempotencyKeyStore";
import { showToast } from "@/shared/ui/feedback/Toast";

const initialCreateAccountState = { error: "", version: 0 };

export function useAdminAccountsPageController() {
  const queryClient = useQueryClient();
  const idempotencyKeys = useIdempotencyKeyStore();

  const accountsQuery = useQuery(adminLoginAccountsQueryOptions());

  const [createState, createAction, createPending] = useActionState<
    typeof initialCreateAccountState,
    FormData
  >(async (previous, formData) => {
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
  }, initialCreateAccountState);

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
      showToast({ title: "アカウント設定を更新しました", tone: "success" });
    },
  });

  const error = shouldShowQueryError(accountsQuery) ? accountsQuery.error : undefined;
  const normalizedError = error ? normalizeUnknownApiError(error) : undefined;
  const hasAccountsData = accountsQuery.data !== undefined;

  return {
    accounts: accountsQuery.data?.items ?? [],
    accountsError: normalizedError,
    accountsLoadFailed: shouldShowBlockingQueryError(accountsQuery),
    accountsLoading: isInitialQueryLoading(accountsQuery),
    accountsRefreshing: accountsQuery.isFetching,
    accountsStale: Boolean(normalizedError && hasAccountsData),
    createAction,
    createPending,
    createState,
    retryAccounts: () => void accountsQuery.refetch(),
    updateMutation,
  };
}
