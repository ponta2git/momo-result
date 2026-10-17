import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import {
  accountUpdateConsequence,
  buildAccountSettingsView,
  parseAccountCreateForm,
} from "@/features/masters/accounts/accountSettingsEditing";
import type { AccountSettingsControls } from "@/features/masters/accounts/accountSettingsEditing";
import {
  cacheSavedAccount,
  invalidateAdminAccountCaches,
} from "@/features/masters/accounts/adminAccountCache";
import { createLoginAccount, updateLoginAccount } from "@/shared/api/adminAccounts";
import type { LoginAccountResponse, UpdateLoginAccountRequest } from "@/shared/api/adminAccounts";
import { runIdempotentMutation } from "@/shared/api/idempotency";
import { formatApiError } from "@/shared/api/problemDetails";
import {
  isInitialQueryLoading,
  shouldShowBlockingQueryError,
  shouldShowQueryError,
} from "@/shared/api/queryErrorState";
import { adminLoginAccountsQueryOptions } from "@/shared/api/queryOptions";
import { useIdempotencyKeyStore } from "@/shared/api/useIdempotencyKeyStore";
import { reportSelfAccountDisabled } from "@/shared/auth/accountOperationNotice";
import type { AuthorizationLease } from "@/shared/auth/authorization";
import { useAuthorizationOperations, usePermissionFacts } from "@/shared/auth/useAuthorization";
import { useAuthorizedAction } from "@/shared/auth/useAuthorizedAction";
import { useAuthStatus } from "@/shared/auth/useAuthStatus";
import { useRetryNotice } from "@/shared/lib/useRetryNotice";
import { showToast } from "@/shared/ui/feedback/Toast";

/** Keeps account workflows alive while the user moves between settings tabs. */
export function useAccountSettings(queryEnabled = true): AccountSettingsControls {
  const authorization = useAuthorizationOperations();
  const permission = usePermissionFacts("admin");
  const authStatus = useAuthStatus();
  const queryClient = useQueryClient();
  const idempotencyKeys = useIdempotencyKeyStore();
  const [createOpen, setCreateOpen] = useState(false);
  const canManageAccounts = permission.allowed;
  const [createEpoch, setCreateEpoch] = useState(permission.epoch);
  const [createdReceipt, setCreatedReceipt] = useState<{
    saved: LoginAccountResponse;
    lease: AuthorizationLease;
  }>();
  const appliedAccounts = useRef(new WeakSet<LoginAccountResponse>());
  if (createEpoch !== permission.epoch) {
    setCreateEpoch(permission.epoch);
    setCreateOpen(false);
    setCreatedReceipt(undefined);
  }
  const accountsQuery = useQuery({
    ...adminLoginAccountsQueryOptions(),
    enabled: () =>
      queryEnabled &&
      canManageAccounts &&
      authorization.canRead("admin", adminLoginAccountsQueryOptions().queryKey),
  });

  const [createError, createAction, createPending] = useAuthorizedAction(
    authorization,
    "admin",
    async (previous, formData, lease) => {
      const parsed = parseAccountCreateForm(formData);
      if (parsed.kind === "invalid") return parsed.error;
      const { request } = parsed;

      try {
        const created = await runIdempotentMutation(
          idempotencyKeys,
          "adminAccounts.createLoginAccount",
          request,
          (options) => createLoginAccount(request, options),
        );
        if (authorization.isCurrent(lease)) setCreatedReceipt({ saved: created, lease });
        return "";
      } catch (error) {
        authorization.reportError(error, lease);
        if (!authorization.isCurrent(lease)) return previous;
        return formatApiError(error, "ログインアカウントの作成に失敗しました");
      }
    },
    "",
  );

  const updateMutation = useMutation({
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

  const updated = updateMutation.data;
  const updateVariables = updateMutation.variables;
  useEffect(() => {
    const receipt =
      createdReceipt ??
      (updated && updateVariables ? { saved: updated, lease: updateVariables.lease } : undefined);
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
      if (createdReceipt) {
        setCreateOpen(false);
        setCreatedReceipt(undefined);
        showToast({ title: "アカウントを追加しました", tone: "success" });
      } else {
        showToast({ title: "アカウント設定を更新しました", tone: "success" });
      }
    })();
  }, [authorization, permission.allowed, createdReceipt, queryClient, updated, updateVariables]);

  const refreshAccounts = async () =>
    Boolean(authorization.begin("admin")) && (await accountsQuery.refetch()).isSuccess;
  const updateAccount = async (accountId: string, request: UpdateLoginAccountRequest) => {
    const lease = authorization.begin("admin");
    if (!lease) throw new DOMException("権限を確認できません", "AbortError");
    await updateMutation.mutateAsync({ accountId, request, lease });
  };
  const currentCreatePending =
    createPending || Boolean(createdReceipt && authorization.isCurrent(createdReceipt.lease));
  const currentUpdatePending =
    updateMutation.isPending &&
    Boolean(updateVariables && authorization.isCurrent(updateVariables.lease));

  const accounts = permission.retained ? (accountsQuery.data?.items ?? []) : [];

  const loadFailed = useRetryNotice(
    canManageAccounts && shouldShowBlockingQueryError(accountsQuery),
    accountsQuery.isFetching,
  );
  const stale = useRetryNotice(
    canManageAccounts && shouldShowQueryError(accountsQuery),
    accountsQuery.isFetching,
  );
  const view = buildAccountSettingsView({
    authChecking: authStatus.isChecking,
    initialLoading: isInitialQueryLoading(accountsQuery),
    loadFailed,
    stale,
    error: accountsQuery.error,
    items: accounts,
    fetching: accountsQuery.isFetching,
    createPending: currentCreatePending,
    updatePending: currentUpdatePending,
    refresh: refreshAccounts,
  });

  return {
    create: {
      action: createAction,
      disabled: view.createDisabled,
      error: createError,
      open: permission.retained && createOpen,
      pending: currentCreatePending,
      setOpen: (open) => {
        if (!open || authorization.can("admin")) setCreateOpen(open);
      },
    },
    list: view.list,
    pending: view.pending,
    update: {
      pending: currentUpdatePending,
      operationFor: (accountId) =>
        currentUpdatePending && updateMutation.variables?.accountId === accountId
          ? updateMutation.variables.request.role === undefined
            ? "login"
            : "role"
          : undefined,
      changeRole: (accountId, role) => updateAccount(accountId, { role }),
      changeLoginEnabled: (accountId, enabled) =>
        updateAccount(accountId, { loginEnabled: enabled }),
    },
  };
}
