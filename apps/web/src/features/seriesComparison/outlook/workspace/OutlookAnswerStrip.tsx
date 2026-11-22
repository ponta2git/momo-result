import { cn } from "@/shared/ui/cn";
import { contentText } from "@/shared/ui/typography";

/**
 * Both answers, fixed under the navigation where the questions cannot sit side by side. It
 * repeats what the question blocks announce, so it stays out of the accessibility tree.
 */
export function OutlookAnswerStrip({
  placement,
  trend,
  goal,
}: {
  placement: "page" | "column";
  trend: string;
  goal: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "sticky top-(--global-nav-height) z-(--z-sticky) border-b border-border bg-surface py-2",
        placement === "page"
          ? "-mx-4 px-4 sm:-mx-6 sm:px-6 lg:hidden"
          : "hidden lg:block xl:hidden",
      )}
    >
      <p className={contentText.supporting}>この平均が続くと</p>
      <p className={cn(contentText.compactPrimary, "truncate")}>{trend}</p>
      <p className={cn(contentText.supporting, "truncate")}>{goal}</p>
    </div>
  );
}
