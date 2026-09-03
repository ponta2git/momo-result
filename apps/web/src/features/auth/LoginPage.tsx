import { LogIn } from "lucide-react";
import { useSearchParams } from "react-router-dom";

import { AuthPanel } from "@/shared/auth/AuthPanel";
import { sanitizeAppRedirectPath } from "@/shared/auth/redirectPath";
import { Notice } from "@/shared/ui/feedback/Notice";
import { GlobalNav } from "@/shared/ui/layout/GlobalNav";
import type { GlobalNavItem } from "@/shared/ui/layout/GlobalNav";
import { PageContentSurface } from "@/shared/ui/layout/PageContentSurface";
import { PageFrame, pageViewportGutterClass } from "@/shared/ui/layout/PageFrame";
import { PageHeader } from "@/shared/ui/layout/PageHeader";
import { SkipLink } from "@/shared/ui/layout/SkipLink";

const loginNavItems = [
  { icon: <LogIn />, label: "ログイン", to: "/login" },
] as const satisfies readonly GlobalNavItem[];

export function LoginPage() {
  const [searchParams] = useSearchParams();
  const reason = searchParams.get("reason");
  const next = sanitizeAppRedirectPath(searchParams.get("next"));
  const loginDescription = "ログインすると、試合の記録・確認・比較・出力を利用できます。";

  return (
    <div className="flex min-h-dvh flex-col">
      <SkipLink />
      <GlobalNav
        brandTo="/login"
        environmentLabel={import.meta.env.DEV ? "DEV" : undefined}
        items={loginNavItems}
      />
      <main className="flex-1" id="main-content">
        <PageFrame className={`${pageViewportGutterClass} py-4 sm:py-6`} width="narrow">
          <div className="mx-auto grid w-full max-w-[34rem] gap-6">
            <PageHeader description={loginDescription} title="ログイン" />
            <PageContentSurface className="space-y-4">
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
      </main>
    </div>
  );
}
