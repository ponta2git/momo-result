import { useState } from "react";

import {
  changeOcrSetupValue,
  deriveValidSetupValue,
  resolveOcrSetupValidation,
  sameSetupValue,
} from "@/features/ocrCapture/ocrSetupModel";
import type { OcrSetupChange } from "@/features/ocrCapture/ocrSetupModel";
import { buildOcrSetupPanelFields } from "@/features/ocrCapture/ocrSetupPanelModel";
import type { OcrSetupPanelModel } from "@/features/ocrCapture/ocrSetupPanelModel";
import type { SetupFormValues } from "@/features/ocrCapture/schema";
import { useOcrSetupOptions } from "@/features/ocrCapture/useOcrSetupOptions";

/** Owns editable setup and reconciles candidate reads without replacing a newer input. */
export function useOcrSetup({
  enabled,
  initialValue,
}: {
  enabled: boolean;
  initialValue: SetupFormValues;
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

  const { resolution, blockedReason } = resolveOcrSetupValidation(value, enabled, options);
  const change = (intent: OcrSetupChange) => {
    setValue((current) => changeOcrSetupValue(current, intent));
  };
  const panel: OcrSetupPanelModel = {
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
