import { ArrowLeft } from "lucide-react";

import { Button } from "@/shared/ui/actions/Button";
import { LinkButton } from "@/shared/ui/actions/LinkButton";
import { Notice } from "@/shared/ui/feedback/Notice";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import type { PageFrameWidth } from "@/shared/ui/layout/PageFrame";

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
      <Notice
        action={
          props.kind === "error" ? (
            <Button
              pending={props.retrying ?? false}
              pendingLabel="再読み込み中"
              size="sm"
              variant="secondary"
              onClick={props.onRetry}
            >
              {props.retryLabel}
            </Button>
          ) : undefined
        }
        tone={props.kind === "not-found" ? "warning" : "danger"}
        title={props.title}
      >
        <p>{props.description}</p>
      </Notice>
      <LinkButton
        icon={<ArrowLeft aria-hidden="true" className="size-4" />}
        to={props.backHref}
        variant="secondary"
      >
        {props.backLabel}
      </LinkButton>
    </PageFrame>
  );
}
