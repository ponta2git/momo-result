import { apiRequest } from "@/shared/api/client";
import type { IdempotencyRequestOptions } from "@/shared/api/client";
import type { components } from "@/shared/api/generated";

export type LoginAccountListResponse = components["schemas"]["LoginAccountListResponse"];
export type LoginAccountResponse = components["schemas"]["LoginAccountResponse"];
export type CreateLoginAccountRequest = components["schemas"]["CreateLoginAccountRequest"];
export type UpdateLoginAccountRequest = components["schemas"]["UpdateLoginAccountRequest"];

export async function listLoginAccounts(): Promise<LoginAccountListResponse> {
  return apiRequest<LoginAccountListResponse>("/api/admin/login-accounts");
}

export async function createLoginAccount(
  request: CreateLoginAccountRequest,
  options: IdempotencyRequestOptions = {},
): Promise<LoginAccountResponse> {
  return apiRequest<LoginAccountResponse>("/api/admin/login-accounts", {
    method: "POST",
    body: request,
    idempotency: options.idempotencyKey ? { key: options.idempotencyKey } : "auto",
  });
}

export async function updateLoginAccount(
  accountId: string,
  request: UpdateLoginAccountRequest,
): Promise<LoginAccountResponse> {
  return apiRequest<LoginAccountResponse>(
    `/api/admin/login-accounts/${encodeURIComponent(accountId)}`,
    {
      method: "PATCH",
      body: request,
    },
  );
}
