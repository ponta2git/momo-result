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
  readonly pending: boolean;
  readonly run: () => Promise<boolean>;
};

export type AdminAccountListView =
  | { readonly kind: "loading" }
  | {
      readonly error: Readonly<Pick<NormalizedApiError, "title" | "detail">> | undefined;
      readonly kind: "loadFailed";
      readonly refresh: AccountListRefresh;
    }
  | {
      readonly items: ReadonlyArray<Readonly<LoginAccountResponse>>;
      readonly kind: "ready";
      readonly refresh: AccountListRefresh;
      readonly stale: boolean;
    };

export type AdminAccountCreateForm = {
  readonly action: (formData: FormData) => void;
  readonly disabled: boolean;
  readonly error: string;
  readonly open: boolean;
  readonly pending: boolean;
  readonly setOpen: (open: boolean) => void;
};

export type AccountOperation = "login" | "role";

export type AccountSettingsControls = {
  readonly create: AdminAccountCreateForm;
  readonly list: AdminAccountListView;
  readonly pending: boolean;
  readonly update: {
    readonly pending: boolean;
    readonly operationFor: (accountId: string) => AccountOperation | undefined;
    readonly changeRole: (accountId: string, role: AccountRole) => Promise<void>;
    readonly changeLoginEnabled: (accountId: string, enabled: boolean) => Promise<void>;
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

/** Initial failure and a cached empty account list remain distinct. */
export function buildAccountListView(input: {
  authChecking: boolean;
  initialLoading: boolean;
  loadFailed: boolean;
  stale: boolean;
  error: unknown;
  items: ReadonlyArray<Readonly<LoginAccountResponse>>;
  fetching: boolean;
  refresh: () => Promise<boolean>;
}): AdminAccountListView {
  const refresh = { pending: input.fetching, run: input.refresh };
  let list: AdminAccountListView;
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
  return list;
}

export function buildAccountSettingsView(input: {
  list: AdminAccountListView;
  createPending: boolean;
  updatePending: boolean;
}) {
  const pending = input.createPending || input.updatePending;
  const list: AdminAccountListView =
    input.list.kind === "loading"
      ? input.list
      : {
          ...input.list,
          refresh: { ...input.list.refresh, pending: input.list.refresh.pending && !pending },
        };
  return { list, pending, createDisabled: list.kind !== "ready" || pending };
}

export function buildAccountActionView(
  account: Readonly<LoginAccountResponse>,
  selectedRole: AccountRole,
  pendingOperation: AccountOperation | undefined,
) {
  return {
    login: {
      pending: pendingOperation === "login",
      title: account.loginEnabled ? "ログインを停止しますか？" : "ログインを許可しますか？",
      confirmLabel: account.loginEnabled ? "停止する" : "許可する",
      triggerLabel: account.loginEnabled ? "ログイン停止" : "ログイン許可",
      tone: account.loginEnabled ? ("danger" as const) : ("primary" as const),
      nextEnabled: !account.loginEnabled,
    },
    role: {
      pending: pendingOperation === "role",
      confirmDisabled: selectedRole === account.role,
      tone:
        account.role === "admin" && selectedRole !== "admin"
          ? ("danger" as const)
          : ("primary" as const),
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
