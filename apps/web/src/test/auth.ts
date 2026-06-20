export const testDevUserAccountId = "account_ponta";
export const testDevUserStorageKey = "momoresult.devUser";

export function setDevUser(accountId: string = testDevUserAccountId): void {
  window.localStorage.setItem(testDevUserStorageKey, accountId);
}
