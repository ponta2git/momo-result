import type { Ref } from "react";

import { MatchFormActions } from "@/features/matches/workspace/MatchFormActions";
import { MatchSetupSection } from "@/features/matches/workspace/MatchSetupSection";
import { ScoreGrid } from "@/features/matches/workspace/scoreGrid/ScoreGrid";
import { SourceImagePanel } from "@/features/matches/workspace/sourceImages/SourceImagePanel";
import type { MatchWorkspaceController } from "@/features/matches/workspace/useMatchWorkspaceController";
import { cn } from "@/shared/ui/cn";
import { Card } from "@/shared/ui/layout/Card";

type MatchWorkspaceEditorProps = {
  editor: MatchWorkspaceController["editor"];
  formActions: MatchWorkspaceController["formActions"];
  primaryActionRef: Ref<HTMLButtonElement>;
  setup: MatchWorkspaceController["setup"];
  onRequestSubmitFocus: () => void;
};

export function MatchWorkspaceEditor({
  editor,
  formActions,
  primaryActionRef,
  setup,
  onRequestSubmitFocus,
}: MatchWorkspaceEditorProps) {
  return (
    <>
      <MatchSetupSection {...setup} />

      {editor.warnings.length > 0 ? (
        <Card className="mt-4 border-[var(--color-warning)]/65 bg-[var(--color-warning)]/18">
          <ul className="list-disc pl-5 text-sm text-[var(--color-text-primary)]">
            {editor.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </Card>
      ) : null}

      <div
        className={cn(
          "mt-4 grid gap-4",
          editor.sourceImagePanel
            ? "xl:grid-cols-[minmax(0,1fr)_24rem] 2xl:grid-cols-[minmax(0,1fr)_28rem]"
            : "",
        )}
      >
        <Card className="p-4">
          <ScoreGrid {...editor.scoreGrid} onRequestSubmitFocus={onRequestSubmitFocus} />
        </Card>

        {editor.sourceImagePanel ? <SourceImagePanel {...editor.sourceImagePanel} /> : null}
      </div>

      {editor.validationMessage ? (
        <Card className="mt-4 border-[var(--color-warning)]/65 bg-[var(--color-warning)]/18">
          {editor.validationMessage}
        </Card>
      ) : null}

      <MatchFormActions {...formActions} primaryActionRef={primaryActionRef} />
    </>
  );
}
