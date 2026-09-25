import type { AnchorHTMLAttributes, Ref, SyntheticEvent } from "react";
import { useHref, useLinkClickHandler } from "react-router-dom";
import type { LinkProps } from "react-router-dom";

import { useSurfaceFeedback } from "@/shared/ui/motion/useSurfaceFeedback";

type RouterOptions = Pick<
  LinkProps,
  "preventScrollReset" | "relative" | "reloadDocument" | "replace" | "state" | "viewTransition"
>;

type NativeDestination = { href: string; to?: never } & {
  [Key in keyof RouterOptions]?: never;
};
type RouterDestination = RouterOptions & { href?: never; to: LinkProps["to"] };

type AnchorProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "aria-disabled"> & {
  "aria-disabled"?: never;
  disabled?: boolean | undefined;
  pending?: boolean | undefined;
  ref?: Ref<HTMLAnchorElement>;
};

export type ActionLinkProps = Omit<AnchorProps, "href"> & (NativeDestination | RouterDestination);

function preventActivation(event: SyntheticEvent<HTMLAnchorElement>) {
  event.preventDefault();
  event.stopPropagation();
}

/** Keeps one anchor through availability changes; Router owns internal navigation. */
export function ActionLink(props: ActionLinkProps) {
  return props.to === undefined ? <ActionAnchor {...props} /> : <RouterActionLink {...props} />;
}

function RouterActionLink({
  to,
  onClick,
  ...props
}: Omit<AnchorProps, "href"> & RouterDestination) {
  const absoluteHref =
    typeof to === "string" && /^(?:[a-z][a-z0-9+.-]*:|\/\/)/iu.test(to) ? to : undefined;
  const routeTo = absoluteHref === undefined ? to : "/";
  const href = useHref(routeTo, props);
  const navigate = useLinkClickHandler<HTMLAnchorElement>(routeTo, {
    ...props,
    target: props.target ?? "_self",
  });
  const {
    preventScrollReset: _preventScrollReset,
    relative: _relative,
    reloadDocument,
    replace: _replace,
    state: _state,
    viewTransition: _viewTransition,
    ...anchorProps
  } = props;

  return (
    <ActionAnchor
      {...anchorProps}
      href={absoluteHref ?? href}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented && !reloadDocument && absoluteHref === undefined) {
          navigate(event);
        }
      }}
    />
  );
}

function ActionAnchor({
  children,
  disabled = false,
  href,
  pending = false,
  ref,
  tabIndex,
  ...props
}: AnchorProps) {
  const surfaceRef = useSurfaceFeedback(ref);
  const unavailable = disabled || pending;

  return (
    <a
      {...props}
      ref={surfaceRef}
      aria-disabled={unavailable || undefined}
      // Retain a pending href: removing it in the initiating click cancels document navigation.
      href={disabled ? undefined : href}
      role={disabled ? "link" : undefined}
      tabIndex={unavailable ? (tabIndex ?? -1) : tabIndex}
      onAuxClickCapture={unavailable ? preventActivation : props.onAuxClickCapture}
      onClickCapture={unavailable ? preventActivation : props.onClickCapture}
      onContextMenuCapture={pending ? preventActivation : props.onContextMenuCapture}
      onKeyDownCapture={(event) => {
        if (unavailable && (event.key === "Enter" || event.key === " ")) {
          preventActivation(event);
        } else {
          props.onKeyDownCapture?.(event);
        }
      }}
    >
      {children}
    </a>
  );
}
