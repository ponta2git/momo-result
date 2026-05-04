/**
 * CSRF トークンの保管所。
 *
 * `apiRequest` 全体のモジュールレベル変数として持つと「どの呼び出しが値を書き換えたか」
 * が追いにくくなるため、書き込み・読み取り・破棄を 1 ファイルに閉じ込めて単一責務にする。
 *
 * 取得元のセッションが終了したら `clearCsrfToken()` を呼んで破棄すること。
 * 値はメモリ上のみで保持し、永続化は行わない。
 */
let csrfToken: string | undefined;

export function getCsrfToken(): string | undefined {
  return csrfToken;
}

export function setCsrfToken(token: string | undefined): void {
  csrfToken = token;
}

export function clearCsrfToken(): void {
  csrfToken = undefined;
}
