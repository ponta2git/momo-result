import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { accountRoleOptions } from "@/features/masters/accounts/accountRoles";
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
import { formatApiError, normalizeUnknownApiError } from "@/shared/api/problemDetails";
import type { NormalizedApiError } from "@/shared/api/problemDetails";
import {
  isInitialQueryLoading,
  shouldShowBlockingQueryError,
  shouldShowQueryError,
} from "@/shared/api/queryErrorState";
import { adminLoginAccountsQueryOptions } from "@/shared/api/queryOptions";
import { useIdempotencyKeyStore } from "@/shared/api/useIdempotencyKeyStore";
import { reportSelfAccountDisabled } from "@/shared/auth/accountOperationNotice";
import type { AuthorizationLease } from "@/shared/auth/authorization";
import { useAuthorization } from "@/shared/auth/useAuthorization";
import { useAuthorizedAction } from "@/shared/auth/useAuthorizedAction";
import { useRetryNotice } from "@/shared/lib/useRetryNotice";
import { showToast } from "@/shared/ui/feedback/Toast";

type AccountListRefresh = {
  pending: boolean;
  run: () => Promise<boolean>;
};

export type AdminAccountListModel =
  | { kind: "loading" }
  | { error: NormalizedApiError | undefined; kind: "loadFailed"; refresh: AccountListRefresh }
  | {
      items: LoginAccountResponse[];
      kind: "ready";
      refresh: AccountListRefresh;
      stale: boolean;
    };

export type AdminAccountCreateDialogModel = {
  action: (formData: FormData) => void;
  error: string;
  formKey: number;
  open: boolean;
  pending: boolean;
  setOpen: (open: boolean) => void;
};

type AdminAccountUpdateModel = {
  pending: boolean;
  pendingRequestFor: (accountId: string) => UpdateLoginAccountRequest | undefined;
  run: (accountId: string, request: UpdateLoginAccountRequest) => Promise<void>;
};

export type AccountSettingsModel = {
  create: AdminAccountCreateDialogModel;
  list: AdminAccountListModel;
  pending: boolean;
  update: AdminAccountUpdateModel;
};

const initialCreateAccountState = { error: "", formKey: 0 };

/** Keeps account workflows alive while the user moves between settings tabs. */
export function useAccountSettingsModel(queryEnabled = true): AccountSettingsModel {
  const authorization = useAuthorization();
  const { auth } = authorization;
  const queryClient = useQueryClient();
  const idempotencyKeys = useIdempotencyKeyStore();
  const [createOpen, setCreateOpen] = useState(false);
  const canManageAccounts = authorization.allowed.admin;
  const [createEpoch, setCreateEpoch] = useState(authorization.epoch.admin);
  const [createdReceipt, setCreatedReceipt] = useState<{
    saved: LoginAccountResponse;
    lease: AuthorizationLease;
  }>();
  const applied = useRef(new WeakSet<LoginAccountResponse>());
  if (createEpoch !== authorization.epoch.admin) {
    setCreateEpoch(authorization.epoch.admin);
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

  const [createState, createAction, createPending] = useAuthorizedAction<
    typeof initialCreateAccountState
  >(
    authorization,
    "admin",
    async (previous, formData, lease) => {
      const playerMemberId = String(formData.get("playerMemberId") ?? "");
      const role = accountRoleOptions.find(
        (option) => option.value === formData.get("role"),
      )?.value;
      if (!role) return { error: "ロールを選択してください", formKey: previous.formKey };
      const request: CreateLoginAccountRequest = {
        discordUserId: String(formData.get("discordUserId") ?? ""),
        displayName: String(formData.get("displayName") ?? ""),
        role,
        loginEnabled: formData.get("loginEnabled") === "on",
        ...(playerMemberId ? { playerMemberId } : {}),
      };

      try {
        const created = await runIdempotentMutation(
          idempotencyKeys,
          "adminAccounts.createLoginAccount",
          request,
          (options) => createLoginAccount(request, options),
        );
        if (authorization.isCurrent(lease)) setCreatedReceipt({ saved: created, lease });
        return { error: "", formKey: previous.formKey };
      } catch (error) {
        authorization.reportError(error, lease);
        if (!authorization.isCurrent(lease)) return previous;
        return {
          error: formatApiError(error, "ログインアカウントの作成に失敗しました"),
          formKey: previous.formKey,
        };
      }
    },
    initialCreateAccountState,
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
      const selfDisabled = accountId === lease.accountId && request.loginEnabled === false;
      const selfDemoted = accountId === lease.accountId && saved.role !== "admin";
      if (selfDisabled) {
        if (authorization.isCurrent(lease)) reportSelfAccountDisabled(accountId);
        await authorization.recheck();
      } else if (selfDemoted) {
        await authorization.acceptSelfRole(lease, saved.role);
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
    if (!receipt || applied.current.has(receipt.saved) || !authorization.canCommit(receipt.lease))
      return;
    applied.current.add(receipt.saved);
    void (async () => {
      await cacheSavedAccount(queryClient, receipt.saved, () =>
        authorization.canCommit(receipt.lease),
      );
      if (!authorization.canCommit(receipt.lease)) {
        applied.current.delete(receipt.saved);
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
  }, [authorization, createdReceipt, queryClient, updated, updateVariables]);

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

  const accounts = authorization.retained.admin ? (accountsQuery.data?.items ?? []) : [];

  const refresh = {
    pending: accountsQuery.isFetching && !currentCreatePending && !currentUpdatePending,
    run: refreshAccounts,
  };
  const loadFailed = useRetryNotice(
    canManageAccounts && shouldShowBlockingQueryError(accountsQuery),
    accountsQuery.isFetching,
  );
  const stale = useRetryNotice(
    canManageAccounts && shouldShowQueryError(accountsQuery),
    accountsQuery.isFetching,
  );
  let list: AdminAccountListModel;
  if (auth.isChecking || (isInitialQueryLoading(accountsQuery) && !loadFailed)) {
    list = { kind: "loading" };
  } else if (loadFailed) {
    list = {
      error: accountsQuery.error ? normalizeUnknownApiError(accountsQuery.error) : undefined,
      kind: "loadFailed",
      refresh,
    };
  } else {
    list = {
      items: accounts,
      kind: "ready",
      refresh,
      stale,
    };
  }

  return {
    create: {
      action: createAction,
      error: createState.error,
      formKey: createState.formKey,
      open: authorization.retained.admin && createOpen,
      pending: currentCreatePending,
      setOpen: (open) => {
        if (!open || authorization.can("admin")) setCreateOpen(open);
      },
    },
    list,
    pending: currentCreatePending || currentUpdatePending,
    update: {
      pending: currentUpdatePending,
      pendingRequestFor: (accountId) =>
        currentUpdatePending && updateMutation.variables?.accountId === accountId
          ? updateMutation.variables.request
          : undefined,
      run: updateAccount,
    },
  };
}
