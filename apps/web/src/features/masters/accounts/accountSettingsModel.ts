import { accountRoleFromInput } from "@/features/masters/accounts/accountRoles";
import type { AccountRole } from "@/features/masters/accounts/accountRoles";
import type {
  CreateLoginAccountRequest,
  LoginAccountResponse,
  UpdateLoginAccountRequest,
} from "@/shared/api/adminAccounts";
import { normalizeUnknownApiError } from "@/shared/api/problemDetails";
import type { NormalizedApiError } from "@/shared/api/problemDetails";

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
  disabled: boolean;
  error: string;
  open: boolean;
  pending: boolean;
  setOpen: (open: boolean) => void;
};

export type AccountSettingsModel = {
  create: AdminAccountCreateDialogModel;
  list: AdminAccountListModel;
  pending: boolean;
  update: {
    pending: boolean;
    pendingRequestFor: (accountId: string) => UpdateLoginAccountRequest | undefined;
    run: (accountId: string, request: UpdateLoginAccountRequest) => Promise<void>;
  };
};

export function parseAccountCreateForm(
  formData: FormData,
): { kind: "ready"; request: CreateLoginAccountRequest } | { kind: "invalid"; error: string } {
  const role = accountRoleFromInput(formData.get("role"));
  if (!role) return { kind: "invalid", error: "ロールを選択してください" };
  const playerMemberId = String(formData.get("playerMemberId") ?? "");
  return {
    kind: "ready",
    request: {
      discordUserId: String(formData.get("discordUserId") ?? ""),
      displayName: String(formData.get("displayName") ?? ""),
      role,
      loginEnabled: formData.get("loginEnabled") === "on",
      ...(playerMemberId ? { playerMemberId } : {}),
    },
  };
}

/** Initial failure, cached empty data, and an in-flight write remain distinct. */
export function buildAccountSettingsView(input: {
  authChecking: boolean;
  initialLoading: boolean;
  loadFailed: boolean;
  stale: boolean;
  error: unknown;
  items: LoginAccountResponse[];
  fetching: boolean;
  createPending: boolean;
  updatePending: boolean;
  refresh: () => Promise<boolean>;
}) {
  const pending = input.createPending || input.updatePending;
  const refresh = { pending: input.fetching && !pending, run: input.refresh };
  let list: AdminAccountListModel;
  if (input.authChecking || (input.initialLoading && !input.loadFailed)) {
    list = { kind: "loading" };
  } else if (input.loadFailed) {
    list = {
      error: input.error ? normalizeUnknownApiError(input.error) : undefined,
      kind: "loadFailed",
      refresh,
    };
  } else {
    list = { items: input.items, kind: "ready", refresh, stale: input.stale };
  }
  return { list, pending, createDisabled: list.kind !== "ready" || pending };
}

export function accountActionView(
  account: LoginAccountResponse,
  selectedRole: AccountRole,
  pendingRequest: UpdateLoginAccountRequest | undefined,
) {
  return {
    login: {
      pending: pendingRequest?.loginEnabled !== undefined,
      title: account.loginEnabled ? "ログインを停止しますか？" : "ログインを許可しますか？",
      confirmLabel: account.loginEnabled ? "停止する" : "許可する",
      triggerLabel: account.loginEnabled ? "ログイン停止" : "ログイン許可",
      tone: account.loginEnabled ? ("danger" as const) : ("primary" as const),
      request: { loginEnabled: !account.loginEnabled },
    },
    role: {
      pending: pendingRequest?.role !== undefined,
      confirmDisabled: selectedRole === account.role,
      tone:
        account.role === "admin" && selectedRole !== "admin"
          ? ("danger" as const)
          : ("primary" as const),
      request: { role: selectedRole },
    },
  };
}

export function accountUpdateConsequence(
  currentAccountId: string,
  accountId: string,
  request: UpdateLoginAccountRequest,
  saved: LoginAccountResponse,
): { kind: "none" | "selfDisabled" } | { kind: "selfRoleChanged"; role: AccountRole } {
  if (accountId !== currentAccountId) return { kind: "none" };
  if (request.loginEnabled === false) return { kind: "selfDisabled" };
  if (saved.role !== "admin") return { kind: "selfRoleChanged", role: saved.role };
  return { kind: "none" };
}
