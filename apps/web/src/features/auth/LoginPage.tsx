import { LogIn } from "lucide-react";
import { useSearchParams } from "react-router-dom";

import { AuthPanel } from "@/shared/auth/AuthPanel";
import { sanitizeAppRedirectPath } from "@/shared/auth/redirectPath";
import { Notice } from "@/shared/ui/feedback/Notice";
import { GlobalNav } from "@/shared/ui/layout/GlobalNav";
import type { GlobalNavItem } from "@/shared/ui/layout/GlobalNav";
import { PageContentSurface } from "@/shared/ui/layout/PageContentSurface";
import { PageFrame } from "@/shared/ui/layout/PageFrame";

const loginNavItems = [
  { icon: <LogIn className="size-4" />, label: "ログイン", to: "/login" },
] as const satisfies readonly GlobalNavItem[];

export function LoginPage() {
  const [searchParams] = useSearchParams();
  const reason = searchParams.get("reason");
  const next = sanitizeAppRedirectPath(searchParams.get("next"));
  const loginDescription = import.meta.env.DEV
    ? "操作用アカウントを選ぶと、試合一覧、OCR、CSV/TSV出力を使えます。"
    : "Discordでログインすると、試合一覧、OCR、CSV/TSV出力を使えます。";

  return (
    <>
      <a
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[var(--z-tooltip)] focus:rounded-[var(--radius-sm)] focus:bg-[var(--color-surface)] focus:px-3 focus:py-2 focus:text-sm"
        href="#main-content"
      >
        メインコンテンツへスキップ
      </a>
      <GlobalNav
        brandTo="/login"
        environmentLabel={import.meta.env.DEV ? "DEV" : undefined}
        items={loginNavItems}
      />
      <main id="main-content">
        <PageFrame className="px-3 py-4 sm:px-4 sm:py-6">
          <PageContentSurface className="mx-auto max-w-[34rem] space-y-4">
            <header>
              <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">ログイン</h1>
              <p className="momo-copy mt-2 text-sm text-[var(--color-text-secondary)]">
                {loginDescription}
              </p>
            </header>

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
        </PageFrame>
      </main>
    </>
  );
}
