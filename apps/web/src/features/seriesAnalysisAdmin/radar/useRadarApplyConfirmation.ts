import { useState } from "react";

import type { PlayerRadarAdministrationView } from "@/features/seriesAnalysisAdmin/radar/playerRadarAdminTypes";
import {
  radarApplyConfirmation,
  buildRadarApplyConfirmationView,
} from "@/features/seriesAnalysisAdmin/radar/radarApplyConfirmation";
import type { RadarThresholdEditorView } from "@/features/seriesAnalysisAdmin/radar/radarThresholdEditorModel";
import type { RadarThresholdError } from "@/features/seriesAnalysisAdmin/radar/radarThresholdInput";

/** The confirmed target belongs to the edit, independently of dialog DOM/focus. */
export function useRadarApplyConfirmation(
  administration: PlayerRadarAdministrationView,
  editor: RadarThresholdEditorView,
  active: boolean,
  prepare: () => Promise<RadarThresholdError | null>,
  finish: () => void,
) {
  const [confirmation, setConfirmation] = useState<ReturnType<typeof radarApplyConfirmation>>(null);
  const [open, setOpen] = useState(false);
  const [previousActive, setPreviousActive] = useState(active);
  if (previousActive !== active) {
    setPreviousActive(active);
    setConfirmation(null);
    setOpen(false);
  }
  const current = radarApplyConfirmation(administration);
  if (open && !confirmation && editor.canApply && current) setConfirmation(current);
  const view = buildRadarApplyConfirmationView({
    administration,
    confirmation,
    current,
    open,
    editorActive: editor.active,
    active,
    canApply: editor.canApply,
    applyError: editor.applyError,
    formalMismatch: editor.formalMismatch,
    contextChanged: editor.contextChanged,
    comparisonChanged: editor.comparisonChanged,
  });
  return {
    view,
    request: async () => {
      if (!editor.inputValid) return prepare();
      setConfirmation(editor.canApply ? current : null);
      setOpen(true);
      if (!editor.canApply) return prepare();
      return null;
    },
    setOpen: (next: boolean) => {
      setOpen(false);
      setConfirmation(next ? current : null);
    },
    confirm: async () => {
      if (!confirmation || view.disabled) return;
      await administration.actions.apply(confirmation.target);
      finish();
    },
  };
}
