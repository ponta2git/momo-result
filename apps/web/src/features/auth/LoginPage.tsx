import { useSearchParams } from "react-router-dom";

import { AuthPanel } from "@/shared/auth/AuthPanel";
import { Notice } from "@/shared/ui/feedback/Notice";
import { GlobalNav } from "@/shared/ui/layout/GlobalNav";
import { PageFrame } from "@/shared/ui/layout/PageFrame";

export function LoginPage() {
  const [searchParams] = useSearchParams();
  const reason = searchParams.get("reason");

  return (
    <>
      <GlobalNav isAuthenticated={false} />
      <PageFrame>
        <section className="mx-auto w-full max-w-[34rem] space-y-4 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 text-[var(--color-text-primary)]">
          <header>
            <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">ログイン</h1>
            <p className="mt-2 text-sm leading-6 text-[var(--color-text-secondary)]">
              Discordアカウントでログインして、試合一覧・OCR・出力機能を利用します。
            </p>
          </header>

          {reason === "forbidden" ? (
            <Notice tone="warning" title="アクセス権限がありません">
              このアカウントは利用許可されていません。管理者に連絡してください。
            </Notice>
          ) : null}

          <AuthPanel auth={undefined} forceDevPicker={import.meta.env.DEV} />

          <p className="text-xs leading-6 text-[var(--color-text-secondary)]">
            別のDiscordアカウントを使う場合は、Discord側でログアウトするか、シークレットウィンドウを利用してください。
          </p>
        </section>
      </PageFrame>
    </>
  );
}
