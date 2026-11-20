import { sanitizeAppRedirectPath } from "@/shared/auth/redirectPath";

type LoginNotice = { tone: "success" | "warning"; title: string; message: string };

/** Resolves feature notices and redirect input without owning authentication or navigation. */
export function buildLoginView({
  reason,
  requestedNextPath,
  selfAccountDisabled,
}: {
  reason: string | null;
  requestedNextPath: string | null;
  selfAccountDisabled: boolean;
}) {
  const notice: LoginNotice | undefined = selfAccountDisabled
    ? {
        tone: "success",
        title: "アカウント設定を更新しました",
        message: "このアカウントのログインを無効にしました。",
      }
    : reason === "forbidden"
      ? {
          tone: "warning",
          title: "アクセス権限がありません",
          message: "このアカウントでは利用できません。管理者に確認してください。",
        }
      : undefined;
  return {
    notice,
    loginNextPath: sanitizeAppRedirectPath(requestedNextPath),
  };
}
