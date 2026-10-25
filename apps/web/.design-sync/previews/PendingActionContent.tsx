import { RefreshCw, Save } from "lucide-react";
import { buttonClassName, PendingActionContent } from "momo-result-ui";

// PendingActionContent is the inner label of a text action; shown here inside a span styled with
// the shared button recipe (the same composition LinkButton uses), so each state keeps its width.
export const IdleAndPending = () => (
  <div className="flex flex-wrap items-center gap-2">
    <span className={buttonClassName({ variant: "primary" })}>
      <PendingActionContent pending={false}>試合を保存</PendingActionContent>
    </span>
    <span className={buttonClassName({ variant: "primary" })}>
      <PendingActionContent pending>試合を保存</PendingActionContent>
    </span>
  </div>
);

export const WithIcon = () => (
  <div className="flex flex-wrap items-center gap-2">
    <span className={buttonClassName({ variant: "secondary" })}>
      <PendingActionContent icon={<RefreshCw />} pending={false}>
        順位表を再計算
      </PendingActionContent>
    </span>
    <span className={buttonClassName({ variant: "secondary" })}>
      <PendingActionContent icon={<RefreshCw />} pending>
        順位表を再計算
      </PendingActionContent>
    </span>
  </div>
);

export const WithPendingLabel = () => (
  <div className="flex flex-wrap items-center gap-2">
    <span className={buttonClassName({ variant: "primary" })}>
      <PendingActionContent icon={<Save />} pending={false} pendingLabel="保存中…">
        下書きを保存
      </PendingActionContent>
    </span>
    <span className={buttonClassName({ variant: "primary" })}>
      <PendingActionContent icon={<Save />} pending pendingLabel="保存中…">
        下書きを保存
      </PendingActionContent>
    </span>
  </div>
);
