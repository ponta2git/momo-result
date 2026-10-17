import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  accountUpdateConsequence,
  buildAccountListView,
} from "@/features/masters/accounts/accountSettingsEditing";
import type { AccountSettingsControls } from "@/features/masters/accounts/accountSettingsEditing";
import {
  cacheSavedAccount,
  invalidateAdminAccountCaches,
} from "@/features/masters/accounts/adminAccountCache";
import { createLoginAccount, updateLoginAccount } from "@/shared/api/adminAccounts";
import type {
  CreateLoginAccountRequest,
  LoginAccountResponse,
  UpdateLoginAccountRequest,
} from "@/shared/api/adminAccounts";
import { runIdempotentMutation } from "@/shared/api/idempotency";
import {
  isInitialQueryLoading,
  shouldShowBlockingQueryError,
  shouldShowQueryError,
} from "@/shared/api/queryErrorState";
import { adminLoginAccountsQueryOptions } from "@/shared/api/queryOptions";
import { useIdempotencyKeyStore } from "@/shared/api/useIdempotencyKeyStore";
import { reportSelfAccountDisabled } from "@/shared/auth/accountOperationNotice";
import type { AuthorizationLease } from "@/shared/auth/authorization";
import { canReadProtectedQuery } from "@/shared/auth/authorizationQueryAdapter";
import { useAuthorizationOperations, usePermissionFacts } from "@/shared/auth/useAuthorization";
import { useAuthStatus } from "@/shared/auth/useAuthStatus";
import { useRetryNotice } from "@/shared/lib/useRetryNotice";

/** Retains confirmed writes through authorization checks and reconciles the account directory. */
export function useAccountSettingsResource(
  enabled: boolean,
  onSaved: (kind: "created" | "updated") => void,
) {
  const authorization = useAuthorizationOperations();
  const permission = usePermissionFacts("admin");
  const authStatus = useAuthStatus();
  const queryClient = useQueryClient();
  const idempotencyKeys = useIdempotencyKeyStore();
  const [receiptEpoch, setReceiptEpoch] = useState(permission.epoch);
  const [createdReceipt, setCreatedReceipt] = useState<{
    saved: LoginAccountResponse;
    lease: AuthorizationLease;
  }>();
  const appliedAccounts = useRef(new WeakSet<LoginAccountResponse>());
  if (receiptEpoch !== permission.epoch) {
    setReceiptEpoch(permission.epoch);
    setCreatedReceipt(undefined);
  }
  const query = useQuery({
    ...adminLoginAccountsQueryOptions(),
    enabled: () =>
      enabled &&
      permission.allowed &&
      canReadProtectedQuery(
        authorization,
        queryClient,
        "admin",
        adminLoginAccountsQueryOptions().queryKey,
      ),
  });
  const create = useCallback(
    async (request: CreateLoginAccountRequest, lease: AuthorizationLease) => {
      const saved = await runIdempotentMutation(
        idempotencyKeys,
        "adminAccounts.createLoginAccount",
        request,
        (options) => createLoginAccount(request, options),
      );
      if (authorization.isCurrent(lease)) setCreatedReceipt({ saved, lease });
    },
    [authorization, idempotencyKeys],
  );
  const mutation = useMutation({
    mutationFn: ({
      accountId,
      request,
      lease,
    }: {
      accountId: string;
      request: UpdateLoginAccountRequest;
      lease: AuthorizationLease;
    }) => {
      if (!authorization.canCommit(lease))
        throw new DOMException("権限を確認できません", "AbortError");
      return runIdempotentMutation(
        idempotencyKeys,
        "adminAccounts.updateLoginAccount",
        { accountId, request },
        (options) => updateLoginAccount(accountId, request, options),
      );
    },
    onSuccess: async (saved, { accountId, request, lease }) => {
      if (!authorization.isSameAccount(lease)) return;
      const consequence = accountUpdateConsequence(lease.accountId, accountId, request, saved);
      if (consequence.kind === "selfDisabled") {
        if (authorization.isCurrent(lease)) reportSelfAccountDisabled(accountId);
        await authorization.recheck();
      } else if (consequence.kind === "selfRoleChanged") {
        await authorization.acceptSelfRole(lease, consequence.role);
      }
    },
    onError: (error, { lease }) => authorization.reportError(error, lease),
  });
  const { data: updated, variables, mutateAsync } = mutation;
  useEffect(() => {
    const receipt =
      createdReceipt ??
      (updated && variables ? { saved: updated, lease: variables.lease } : undefined);
    if (
      !permission.allowed ||
      !receipt ||
      appliedAccounts.current.has(receipt.saved) ||
      !authorization.canCommit(receipt.lease)
    )
      return;
    appliedAccounts.current.add(receipt.saved);
    void (async () => {
      await cacheSavedAccount(queryClient, receipt.saved, () =>
        authorization.canCommit(receipt.lease),
      );
      if (!authorization.canCommit(receipt.lease)) {
        appliedAccounts.current.delete(receipt.saved);
        return;
      }
      await invalidateAdminAccountCaches(queryClient);
      if (!authorization.isCurrent(receipt.lease)) return;
      if (createdReceipt) setCreatedReceipt(undefined);
      onSaved(createdReceipt ? "created" : "updated");
    })();
  }, [authorization, permission.allowed, createdReceipt, onSaved, queryClient, updated, variables]);

  const refresh = async () =>
    Boolean(authorization.begin("admin")) && (await query.refetch()).isSuccess;
  const updateAccount = async (accountId: string, request: UpdateLoginAccountRequest) => {
    const lease = authorization.begin("admin");
    if (!lease) throw new DOMException("権限を確認できません", "AbortError");
    await mutateAsync({ accountId, request, lease });
  };
  const pending =
    mutation.isPending && Boolean(variables && authorization.isCurrent(variables.lease));
  const loadFailed = useRetryNotice(
    permission.allowed && shouldShowBlockingQueryError(query),
    query.isFetching,
  );
  const stale = useRetryNotice(permission.allowed && shouldShowQueryError(query), query.isFetching);
  const update: AccountSettingsControls["update"] = {
    pending,
    operationFor: (accountId) =>
      pending && variables?.accountId === accountId
        ? variables.request.role === undefined
          ? "login"
          : "role"
        : undefined,
    changeRole: (accountId, role) => updateAccount(accountId, { role }),
    changeLoginEnabled: (accountId, loginEnabled) => updateAccount(accountId, { loginEnabled }),
  };
  return {
    list: buildAccountListView({
      authChecking: authStatus.isChecking,
      initialLoading: isInitialQueryLoading(query),
      loadFailed,
      stale,
      error: query.error,
      items: permission.retained ? (query.data?.items ?? []) : [],
      fetching: query.isFetching,
      refresh,
    }),
    create,
    creationAwaitingAcceptance: Boolean(
      createdReceipt && authorization.isCurrent(createdReceipt.lease),
    ),
    update,
  };
}
