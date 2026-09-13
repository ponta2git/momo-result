import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useActionState, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

import { invalidateAdminAccountCaches } from "@/features/adminAccounts/adminAccountCache";
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
import { useAuth } from "@/shared/auth/useAuth";
import { showToast } from "@/shared/ui/feedback/Toast";
import { useRetryNotice } from "@/shared/ui/feedback/useRetryNotice";

type AccountListRefresh = {
  pending: boolean;
  run: () => void;
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

type AdminAccountCreateModel = {
  dialog: AdminAccountCreateDialogModel;
  open: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
};

type AdminAccountUpdateModel = {
  pending: boolean;
  pendingRequestFor: (accountId: string) => UpdateLoginAccountRequest | undefined;
  run: (accountId: string, request: UpdateLoginAccountRequest) => Promise<void>;
};

export type AdminAccountsPageModel = {
  create: AdminAccountCreateModel;
  list: AdminAccountListModel;
  update: AdminAccountUpdateModel;
};

const initialCreateAccountState = { error: "", formKey: 0 };

/** Owns the account screen's server-state interpretation and account workflows. */
export function useAdminAccountsPageModel(): AdminAccountsPageModel {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const idempotencyKeys = useIdempotencyKeyStore();
  const [createOpen, setCreateOpen] = useState(false);
  const createTriggerRef = useRef<HTMLButtonElement>(null);
  const focusCreateTriggerAfterSuccessRef = useRef(false);

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
      focusCreateTriggerAfterSuccessRef.current = true;
      setCreateOpen(false);
      showToast({ title: "アカウントを追加しました", tone: "success" });
      return { error: "", formKey: previous.formKey + 1 };
    } catch (error) {
      return {
        error: formatApiError(error, "ログインアカウントの作成に失敗しました"),
        formKey: previous.formKey,
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
    }) =>
      runIdempotentMutation(
        idempotencyKeys,
        "adminAccounts.updateLoginAccount",
        { accountId, request },
        (options) => updateLoginAccount(accountId, request, options),
      ),
    onSuccess: async (_response, { accountId, request }) => {
      const selfDisabled = accountId === auth.auth?.accountId && request.loginEnabled === false;
      if (selfDisabled) reportSelfAccountDisabled(accountId);
      await invalidateAdminAccountCaches(queryClient);
      if (!selfDisabled) showToast({ title: "アカウント設定を更新しました", tone: "success" });
    },
  });

  const refreshAccounts = () => {
    void accountsQuery.refetch();
  };
  const updateAccount = async (accountId: string, request: UpdateLoginAccountRequest) => {
    await updateMutation.mutateAsync({ accountId, request });
  };

  const accounts = accountsQuery.data?.items ?? [];
  useEffect(() => {
    if (!createOpen && accounts.length > 0 && focusCreateTriggerAfterSuccessRef.current) {
      focusCreateTriggerAfterSuccessRef.current = false;
      createTriggerRef.current?.focus();
    }
  }, [accounts.length, createOpen]);

  const refresh = {
    pending: accountsQuery.isFetching && !createPending && !updateMutation.isPending,
    run: refreshAccounts,
  };
  const loadFailed = useRetryNotice(
    shouldShowBlockingQueryError(accountsQuery),
    accountsQuery.isFetching,
  );
  const stale = useRetryNotice(shouldShowQueryError(accountsQuery), accountsQuery.isFetching);
  let list: AdminAccountListModel;
  if (isInitialQueryLoading(accountsQuery) && !loadFailed) {
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
      dialog: {
        action: createAction,
        error: createState.error,
        formKey: createState.formKey,
        open: createOpen,
        pending: createPending,
        setOpen: setCreateOpen,
      },
      open: () => setCreateOpen(true),
      triggerRef: createTriggerRef,
    },
    list,
    update: {
      pending: updateMutation.isPending,
      pendingRequestFor: (accountId) =>
        updateMutation.isPending && updateMutation.variables?.accountId === accountId
          ? updateMutation.variables.request
          : undefined,
      run: updateAccount,
    },
  };
}
