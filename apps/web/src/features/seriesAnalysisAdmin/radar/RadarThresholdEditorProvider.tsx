import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";

import type { PlayerRadarAdministrationView } from "@/features/seriesAnalysisAdmin/radar/playerRadarAdminTypes";
import type {
  RadarEditingControls,
  RadarThresholdEditor,
} from "@/features/seriesAnalysisAdmin/radar/radarThresholdEditorModel";
import { useRadarThresholdEditor } from "@/features/seriesAnalysisAdmin/radar/useRadarThresholdEditor";
import { UnsavedChangesGuard } from "@/shared/navigation/UnsavedChangesGuard";

const EditingContext = createContext<RadarThresholdEditor | null>(null);
const ControlsContext = createContext<RadarEditingControls | null>(null);

/** Input changes belong to the editing workspace, not the surrounding administration panel. */
export function RadarThresholdEditorProvider({
  administration,
  active,
  children,
}: {
  administration: PlayerRadarAdministrationView;
  active: boolean;
  children: ReactNode;
}) {
  const editor = useRadarThresholdEditor(administration, active);
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
          key={administration.authorizationRevision}
          description="採点境界の変更はまだ適用されていません。このページに残れば編集を続けられます。"
          model={{
            dirty: editor.active,
            isNavigationAllowed: editor.isNavigationAllowed,
            onDiscard: editor.discard,
          }}
          pending={
            editor.preparingApply ||
            administration.applyPending ||
            administration.communicationUnknown
          }
        />
        {children}
      </ControlsContext.Provider>
    </EditingContext.Provider>
  );
}
export function useRadarEditingControls() {
  const controls = useContext(ControlsContext);
  if (!controls) throw new Error("RadarThresholdEditorProvider is required");
  return controls;
}
export function useRadarEditingWorkspace() {
  const editor = useContext(EditingContext);
  if (!editor) throw new Error("RadarThresholdEditorProvider is required");
  return editor;
}
