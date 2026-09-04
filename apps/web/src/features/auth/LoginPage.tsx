import { useSearchParams } from "react-router-dom";

import { AuthPanel } from "@/shared/auth/AuthPanel";
import { sanitizeAppRedirectPath } from "@/shared/auth/redirectPath";
import { Notice } from "@/shared/ui/feedback/Notice";
import { PageContentSurface } from "@/shared/ui/layout/PageContentSurface";
import { PageFrame } from "@/shared/ui/layout/PageFrame";

export function LoginPage() {
  const [searchParams] = useSearchParams();
  const reason = searchParams.get("reason");
  const next = sanitizeAppRedirectPath(searchParams.get("next"));

  return (
    <PageFrame width="narrow">
      <div className="mx-auto w-full max-w-[34rem]">
        <PageContentSurface aria-label="ログイン" className="space-y-4" role="region">
          {reason === "forbidden" ? (
            <Notice tone="warning" title="アクセス権限がありません">
              このアカウントでは利用できません。管理者に確認してください。
            </Notice>
          ) : null}

          <AuthPanel
            auth={undefined}
            embedded
            forceDevPicker={import.meta.env.DEV}
            loginNextPath={next}
          />

          {import.meta.env.DEV ? null : (
            <p className="momo-copy text-xs text-[var(--color-text-secondary)]">
              別のDiscordアカウントを使う場合は、Discord側でログアウトするか、シークレットウィンドウで開きます。
            </p>
          )}
        </PageContentSurface>
      </div>
    </PageFrame>
  );
}
