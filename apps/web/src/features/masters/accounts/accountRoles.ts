import type { LoginAccountResponse } from "@/shared/api/adminAccounts";

export type AccountRole = LoginAccountResponse["role"];

export const accountRoleLabels: Record<AccountRole, string> = {
  user: "一般",
  operator: "運用担当",
  admin: "管理者",
};

export const accountRoleOptions = (["user", "operator", "admin"] as const).map((value) => ({
  label: accountRoleLabels[value],
  value,
}));

export function accountRoleFromInput(value: unknown): AccountRole | undefined {
  return accountRoleOptions.find((option) => option.value === value)?.value;
}
