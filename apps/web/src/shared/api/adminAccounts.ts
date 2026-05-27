import { apiRequest } from "@/shared/api/client";
import type { ApiSignalOptions, IdempotencyRequestOptions } from "@/shared/api/client";
import type { components } from "@/shared/api/generated";

export type LoginAccountListResponse = components["schemas"]["LoginAccountListResponse"];
export type LoginAccountResponse = components["schemas"]["LoginAccountResponse"];
export type CreateLoginAccountRequest = components["schemas"]["CreateLoginAccountRequest"];
export type UpdateLoginAccountRequest = components["schemas"]["UpdateLoginAccountRequest"];

export async function listLoginAccounts(
  options: ApiSignalOptions = {},
): Promise<LoginAccountListResponse> {
  return apiRequest<LoginAccountListResponse>("/api/admin/login-accounts", options);
}

export async function createLoginAccount(
  request: CreateLoginAccountRequest,
  options: IdempotencyRequestOptions,
): Promise<LoginAccountResponse> {
  return apiRequest<LoginAccountResponse>("/api/admin/login-accounts", {
    method: "POST",
    body: request,
    idempotency: { key: options.idempotencyKey },
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
