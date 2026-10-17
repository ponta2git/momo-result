import { useSearchParams } from "react-router-dom";

import { buildLoginView } from "@/features/auth/loginView";
import { useSelfAccountDisabledNotice } from "@/shared/auth/accountOperationNotice";
import { AuthPanel } from "@/shared/auth/AuthPanel";
import { Notice } from "@/shared/ui/feedback/Notice";
import { PageContentSurface } from "@/shared/ui/layout/PageContentSurface";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import { contentText } from "@/shared/ui/typography";

function useLoginView() {
  const selfAccountDisabled = useSelfAccountDisabledNotice();
  const [searchParams] = useSearchParams();
  return buildLoginView({
    reason: searchParams.get("reason"),
    requestedNextPath: searchParams.get("next"),
    selfAccountDisabled,
    isDevelopment: import.meta.env.DEV,
  });
}

export function LoginPage() {
  const view = useLoginView();

  return (
    <PageFrame width="narrow">
      <div className="mx-auto w-full max-w-[34rem]">
        <PageContentSurface aria-label="ログイン" className="space-y-4" role="region">
          {view.notice ? (
            <Notice tone={view.notice.tone} title={view.notice.title}>
              {view.notice.message}
            </Notice>
          ) : null}

          <AuthPanel
            auth={undefined}
            embedded
            forceDevPicker={view.forceDevPicker}
            loginNextPath={view.loginNextPath}
          />

          {view.showAccountSwitchHint ? (
            <p className={contentText.supporting}>
              別のDiscordアカウントを使う場合は、Discord側でログアウトするか、シークレットウィンドウで開きます。
            </p>
          ) : null}
        </PageContentSurface>
      </div>
    </PageFrame>
  );
}
