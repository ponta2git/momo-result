import { Skeleton } from "momo-result-ui";

export const Blocks = () => (
  <div className="grid gap-3">
    <Skeleton className="min-h-20" />
    <Skeleton className="min-h-28" />
    <Skeleton className="min-h-40" />
  </div>
);

export const HeadingAndChart = () => (
  <div className="grid gap-3">
    <Skeleton className="h-5 w-48" />
    <Skeleton className="h-32 w-full" />
  </div>
);

export const InlineText = () => (
  <p className="text-sm">
    総資産 <Skeleton as="span" className="inline-block h-4 w-24 align-middle" /> 万円
  </p>
);
