import type { PlayerRadarAdminAction } from "@/features/seriesAnalysisAdmin/playerRadarAdminModel";
import { Button } from "@/shared/ui/actions/Button";

export function PlayerRadarCommandButton({
  action,
  label,
  pendingLabel,
  primary = false,
}: {
  action: PlayerRadarAdminAction;
  label: string;
  pendingLabel: string;
  primary?: boolean;
}) {
  return (
    <Button
      disabled={Boolean(action.disabledReason)}
      pending={action.pending}
      pendingLabel={pendingLabel}
      variant={primary ? "primary" : "secondary"}
      onClick={() => void action.run()}
    >
      {label}
    </Button>
  );
}
