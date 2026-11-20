import { Skeleton } from "@/shared/ui/feedback/Skeleton";

export function PlayerRadarLoading({ label }: { label: string }) {
  return (
    <div aria-label={label} role="status" className="grid min-w-0 gap-4">
      <Skeleton className="h-5 w-48" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}
