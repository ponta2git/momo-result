import { ArrowLeft } from "lucide-react";

import { Button } from "@/shared/ui/actions/Button";
import { LinkButton } from "@/shared/ui/actions/LinkButton";
import { Notice } from "@/shared/ui/feedback/Notice";
import { PageContentSurface } from "@/shared/ui/layout/PageContentSurface";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import type { PageFrameWidth } from "@/shared/ui/layout/PageFrame";
import { PageHeader } from "@/shared/ui/layout/PageHeader";

type ResourcePageStateBase = {
  backHref: string;
  backLabel: string;
  description: string;
  title: string;
  width?: PageFrameWidth | undefined;
};

type ResourceNotFoundState = ResourcePageStateBase & {
  kind: "not-found";
};

type ResourceErrorState = ResourcePageStateBase & {
  kind: "error";
  retryLabel: string;
  retrying?: boolean | undefined;
  onRetry: () => void;
};

export type ResourcePageStateProps = ResourceErrorState | ResourceNotFoundState;

/**
 * Provides terminal page recovery while making not-found and retryable failure impossible
 * to conflate. Resource-specific language and retry effects stay with the feature.
 */
export function ResourcePageState(props: ResourcePageStateProps) {
  return (
    <PageFrame className="gap-4" width={props.width ?? "wide"}>
      <PageHeader title={props.title} />
      <PageContentSurface className="grid justify-items-start gap-4">
        <Notice
          action={
            props.kind === "error" ? (
              <Button
                pending={props.retrying ?? false}
                pendingLabel="再読み込み中"
                size="sm"
                onClick={props.onRetry}
              >
                {props.retryLabel}
              </Button>
            ) : undefined
          }
          tone={props.kind === "not-found" ? "warning" : "danger"}
        >
          <p>{props.description}</p>
        </Notice>
        <LinkButton
          icon={<ArrowLeft aria-hidden="true" />}
          to={props.backHref}
          variant={props.kind === "not-found" ? "primary" : "secondary"}
        >
          {props.backLabel}
        </LinkButton>
      </PageContentSurface>
    </PageFrame>
  );
}
