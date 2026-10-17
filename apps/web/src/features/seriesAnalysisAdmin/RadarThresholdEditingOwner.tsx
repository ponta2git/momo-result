import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";

import type { PlayerRadarAdminModel } from "@/features/seriesAnalysisAdmin/playerRadarAdminModel";
import type {
  RadarEditingControls,
  RadarThresholdEditor,
} from "@/features/seriesAnalysisAdmin/radarThresholdEditorModel";
import { useRadarThresholdEditor } from "@/features/seriesAnalysisAdmin/useRadarThresholdEditor";
import { UnsavedChangesGuard } from "@/shared/navigation/UnsavedChangesGuard";

const EditingContext = createContext<RadarThresholdEditor | null>(null);
const ControlsContext = createContext<RadarEditingControls | null>(null);

/** Input changes belong to the editing workspace, not the surrounding administration panel. */
export function RadarThresholdEditingOwner({
  model,
  active,
  children,
}: {
  model: PlayerRadarAdminModel;
  active: boolean;
  children: ReactNode;
}) {
  const editor = useRadarThresholdEditor(model, active);
  const {
    active: editingActive,
    currentSourceAvailable,
    candidateSourceAvailable,
    saveDisabledReason,
    beginFromCurrent,
    beginFromCandidate,
  } = editor;
  const controls = useMemo(
    () => ({
      active: editingActive,
      currentSourceAvailable,
      candidateSourceAvailable,
      saveDisabledReason,
      beginFromCurrent,
      beginFromCandidate,
    }),
    [
      editingActive,
      currentSourceAvailable,
      candidateSourceAvailable,
      saveDisabledReason,
      beginFromCurrent,
      beginFromCandidate,
    ],
  );
  return (
    <EditingContext.Provider value={editor}>
      <ControlsContext.Provider value={controls}>
        <UnsavedChangesGuard
          // Renew the router subscription when authorization Activity resumes.
          key={model.authorizationRevision}
          description="採点境界の変更はまだ適用されていません。このページに残れば編集を続けられます。"
          model={{
            dirty: editor.active,
            isNavigationAllowed: editor.isNavigationAllowed,
            onDiscard: editor.discard,
          }}
          pending={editor.preparingApply || model.applyPending || model.communicationUnknown}
        />
        {children}
      </ControlsContext.Provider>
    </EditingContext.Provider>
  );
}
export function useRadarEditingControls() {
  const controls = useContext(ControlsContext);
  if (!controls) throw new Error("RadarThresholdEditingOwner is required");
  return controls;
}
export function useRadarEditingWorkspace() {
  const editor = useContext(EditingContext);
  if (!editor) throw new Error("RadarThresholdEditingOwner is required");
  return editor;
}
