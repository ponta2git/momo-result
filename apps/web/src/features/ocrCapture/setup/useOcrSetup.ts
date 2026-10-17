import { useMemo, useState } from "react";

import {
  changeOcrSetupValue,
  deriveValidSetupValue,
  resolveOcrSetupValidation,
  sameSetupValue,
} from "@/features/ocrCapture/setup/ocrSetupModel";
import type { OcrSetupChange } from "@/features/ocrCapture/setup/ocrSetupModel";
import { buildOcrSetupPanelFields } from "@/features/ocrCapture/setup/ocrSetupPanelView";
import type { OcrSetupPanelView } from "@/features/ocrCapture/setup/ocrSetupPanelView";
import type { OcrSetupValues } from "@/features/ocrCapture/setup/ocrSetupSchema";
import { useOcrSetupOptions } from "@/features/ocrCapture/setup/useOcrSetupOptions";

/** Owns editable setup and reconciles candidate reads without replacing a newer input. */
export function useOcrSetup({
  enabled,
  initialValue,
}: {
  enabled: boolean;
  initialValue: OcrSetupValues;
}) {
  const [value, setValue] = useState(initialValue);
  const options = useOcrSetupOptions({ enabled, value });
  const { gameTitles, heldEvents, heldEventContext, mapMasters, seasonMasters } = options;

  const next = deriveValidSetupValue({
    gameTitles,
    heldEventNotFound: heldEventContext === "notFound",
    heldEvents,
    mapMasters,
    seasonMasters,
    value,
  });
  if (!sameSetupValue(next, value)) setValue(next);

  const { ready, loading, refreshing } = options;
  const { resolution, blockedReason } = useMemo(
    () => resolveOcrSetupValidation(value, enabled, { ready, loading, refreshing }),
    [value, enabled, ready, loading, refreshing],
  );
  const change = (intent: OcrSetupChange) => {
    setValue((current) => changeOcrSetupValue(current, intent));
  };
  const panel: OcrSetupPanelView = {
    fields: buildOcrSetupPanelFields({ enabled, options, value }),
    intents: {
      changeGameTitle: (gameTitleId) => change({ kind: "gameTitle", id: gameTitleId }),
      changeHeldEvent: (heldEventId, selected) =>
        change({ kind: "heldEvent", id: heldEventId, nextMatchNo: selected?.nextMatchNo }),
      changeHeldEventPage: options.heldEventPicker.onPageChange,
      changeMap: (id) => change({ kind: "map", id }),
      changeMatchNo: (input) => change({ kind: "matchNo", value: input }),
      changeOwner: (id) => change({ kind: "owner", id }),
      changeSeason: (id) => change({ kind: "season", id }),
    },
  };

  return { blockedReason, options, panel, resolution, value };
}
