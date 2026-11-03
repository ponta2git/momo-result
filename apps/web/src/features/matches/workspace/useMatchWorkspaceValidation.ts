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
  const visibleErrorPathSet =
    ready && (showValidationErrors || mode !== "create") ? validation.pathSet : emptyErrorPathSet;

  return { validation, visibleErrorPathSet };
}
