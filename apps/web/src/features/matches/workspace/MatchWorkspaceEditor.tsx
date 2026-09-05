import { useCallback, useRef } from "react";

import { MatchFormActions } from "@/features/matches/workspace/MatchFormActions";
import { MatchNoteField } from "@/features/matches/workspace/MatchNoteField";
import { MatchSetupSection } from "@/features/matches/workspace/MatchSetupSection";
import type { MatchWorkspaceEditorModel } from "@/features/matches/workspace/matchWorkspacePageModelTypes";
import { MatchWorkspaceRecoveryNotice } from "@/features/matches/workspace/MatchWorkspaceRecoveryNotice";
import { ScoreGrid } from "@/features/matches/workspace/scoreGrid/ScoreGrid";
import { SourceImagePanel } from "@/features/matches/workspace/sourceImages/SourceImagePanel";
import { cn } from "@/shared/ui/cn";
import { Notice } from "@/shared/ui/feedback/Notice";

type MatchWorkspaceEditorProps = {
  model: MatchWorkspaceEditorModel;
};

export function MatchWorkspaceEditor({ model }: MatchWorkspaceEditorProps) {
  const primaryActionRef = useRef<HTMLButtonElement>(null);
  const onRequestSubmitFocus = useCallback(() => {
    primaryActionRef.current?.focus();
  }, []);
  const scoreGridActions = {
    ...model.scoreGrid.actions,
    onRequestSubmitFocus,
  };

  return (
    <>
      <MatchSetupSection
        cancellation={model.persistence.cancellation}
        mastersNavigation={model.navigation.masters}
        model={model.setup}
      />

      {model.persistence.recovery ? (
        <MatchWorkspaceRecoveryNotice model={model.persistence.recovery} />
      ) : null}

      {model.warnings.length > 0 ? (
        <Notice tone="warning" title="入力内容を確認してください">
          <ul className="list-disc pl-5 text-sm text-[var(--color-text-primary)]">
            {model.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </Notice>
      ) : null}

      <div
        className={cn(
          "grid min-w-0 grid-cols-1 gap-4",
          model.sourceImagePanel ? "2xl:grid-cols-[minmax(0,1fr)_minmax(30rem,32rem)]" : "",
        )}
      >
        <div className="order-2 min-w-0 2xl:order-none">
          <ScoreGrid actions={scoreGridActions} data={model.scoreGrid.data} />
          {model.note ? (
            <div className="mt-4">
              <MatchNoteField {...model.note} />
            </div>
          ) : null}
        </div>

        <aside className="contents 2xl:sticky 2xl:top-4 2xl:grid 2xl:h-fit 2xl:gap-4">
          {model.sourceImagePanel ? (
            <div className="order-1 2xl:order-none">
              <SourceImagePanel {...model.sourceImagePanel} />
            </div>
          ) : null}
          <div className="order-3 2xl:order-none">
            <MatchFormActions
              model={model.persistence.submit}
              primaryActionRef={primaryActionRef}
            />
          </div>
        </aside>
      </div>
    </>
  );
}
