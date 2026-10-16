import { useSearchParams } from "react-router-dom";

import { buildLoginPageModel } from "@/features/auth/loginPageModel";
import { useSelfAccountDisabledNotice } from "@/shared/auth/accountOperationNotice";
import { AuthPanel } from "@/shared/auth/AuthPanel";
import { Notice } from "@/shared/ui/feedback/Notice";
import { PageContentSurface } from "@/shared/ui/layout/PageContentSurface";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import { contentText } from "@/shared/ui/typography";

function useLoginPageModel() {
  const selfDisabled = useSelfAccountDisabledNotice();
  const [searchParams] = useSearchParams();
  return buildLoginPageModel({
    reason: searchParams.get("reason"),
    next: searchParams.get("next"),
    selfDisabled,
    development: import.meta.env.DEV,
  });
}

export function LoginPage() {
  const page = useLoginPageModel();

  return (
    <PageFrame width="narrow">
      <div className="mx-auto w-full max-w-[34rem]">
        <PageContentSurface aria-label="ログイン" className="space-y-4" role="region">
          {page.notice ? (
            <Notice tone={page.notice.tone} title={page.notice.title}>
              {page.notice.message}
            </Notice>
          ) : null}

          <AuthPanel
            auth={undefined}
            embedded
            forceDevPicker={page.forceDevPicker}
            loginNextPath={page.loginNextPath}
          />

          {page.showAccountSwitchHint ? (
            <p className={contentText.supporting}>
              別のDiscordアカウントを使う場合は、Discord側でログアウトするか、シークレットウィンドウで開きます。
            </p>
          ) : null}
        </PageContentSurface>
      </div>
    </PageFrame>
  );
}
