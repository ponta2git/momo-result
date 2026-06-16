import { useSearchParams } from "react-router-dom";

import { AuthPanel } from "@/shared/auth/AuthPanel";
import { sanitizeAppRedirectPath } from "@/shared/auth/redirectPath";
import { Notice } from "@/shared/ui/feedback/Notice";
import { GlobalNav } from "@/shared/ui/layout/GlobalNav";
import { PageFrame } from "@/shared/ui/layout/PageFrame";

export function LoginPage() {
  const [searchParams] = useSearchParams();
  const reason = searchParams.get("reason");
  const next = sanitizeAppRedirectPath(searchParams.get("next"));

  return (
    <>
      <a
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[var(--z-tooltip)] focus:rounded-[var(--radius-sm)] focus:bg-[var(--color-surface)] focus:px-3 focus:py-2 focus:text-sm"
        href="#main-content"
      >
        メインコンテンツへスキップ
      </a>
      <GlobalNav isAuthenticated={false} />
      <main id="main-content">
        <PageFrame className="px-3 py-4 sm:px-4 sm:py-6">
          <section className="mx-auto w-full max-w-[34rem] space-y-4 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 text-[var(--color-text-primary)]">
            <header>
              <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">ログイン</h1>
              <p className="momo-copy mt-2 text-sm text-[var(--color-text-secondary)]">
                Discordでログインすると、試合一覧、OCR、CSV/TSV出力を使えます。
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

            <p className="momo-copy text-xs text-[var(--color-text-secondary)]">
              別のDiscordアカウントを使う場合は、Discord側でログアウトするか、シークレットウィンドウで開きます。
            </p>
          </section>
        </PageFrame>
      </main>
    </>
  );
}
