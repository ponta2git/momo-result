import { useDeferredValue, useMemo, useState } from "react";

import type { MatchFormValues, WorkspaceMode } from "@/features/matches/workspace/matchFormTypes";
import { validateMatchForm } from "@/features/matches/workspace/matchFormValidation";

/**
 * Validation follows input through a deferred value so typing stays responsive. Until the
 * initialized values have been validated once, the deferred value can still hold the empty
 * pre-initialization form, so that first result is computed from the current values instead,
 * and nothing is shown as missing before the workspace has finished preparing its values.
 */
export function useMatchWorkspaceValidation({
  mode,
  ready,
  showValidationErrors,
  values,
}: {
  mode: WorkspaceMode;
  ready: boolean;
  showValidationErrors: boolean;
  values: MatchFormValues;
}) {
  const deferredValues = useDeferredValue(values);
  const [settled, setSettled] = useState(false);
  if (!settled && ready && deferredValues === values) setSettled(true);
  const validatedValues = settled ? deferredValues : values;
  const validation = useMemo(() => validateMatchForm(validatedValues), [validatedValues]);
  const emptyErrorPathSet = useMemo(() => new Set<string>(), []);
  // Loaded values show their problems at once, but an input still waiting for its first entry
  // (an unread OCR value) is not an error until the user tries to proceed.
  const drafts = validatedValues.numericDrafts;
  const loadedErrorPathSet = useMemo(
    () => new Set([...validation.pathSet].filter((path) => drafts?.[path] !== "")),
    [drafts, validation.pathSet],
  );
  const visibleErrorPathSet = ready
    ? showValidationErrors
      ? validation.pathSet
      : mode === "create"
        ? emptyErrorPathSet
        : loadedErrorPathSet
    : emptyErrorPathSet;

  return { validation, visibleErrorPathSet };
}
