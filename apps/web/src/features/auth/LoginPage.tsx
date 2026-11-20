import { useSearchParams } from "react-router-dom";

import { buildLoginView } from "@/features/auth/loginView";
import { useSelfAccountDisabledNotice } from "@/shared/auth/accountOperationNotice";
import { AuthPanel } from "@/shared/auth/AuthPanel";
import { Notice } from "@/shared/ui/feedback/Notice";
import { PageContentSurface } from "@/shared/ui/layout/PageContentSurface";
import { PageFrame } from "@/shared/ui/layout/PageFrame";

function useLoginView() {
  const selfAccountDisabled = useSelfAccountDisabledNotice();
  const [searchParams] = useSearchParams();
  return buildLoginView({
    reason: searchParams.get("reason"),
    requestedNextPath: searchParams.get("next"),
    selfAccountDisabled,
  });
}

export function LoginPage() {
  const view = useLoginView();

  return (
    <PageFrame width="readable">
      <PageContentSurface aria-label="ログイン" className="grid gap-4" role="region">
        {view.notice ? (
          <Notice tone={view.notice.tone} title={view.notice.title}>
            {view.notice.message}
          </Notice>
        ) : null}

        <AuthPanel loginNextPath={view.loginNextPath} />
      </PageContentSurface>
    </PageFrame>
  );
}
