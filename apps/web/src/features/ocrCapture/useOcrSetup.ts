import { useState } from "react";

import {
  deriveValidSetupValue,
  sameSetupValue,
} from "@/features/ocrCapture/ocrSetupOptionResolution";
import { buildOcrSetupPanelFields } from "@/features/ocrCapture/ocrSetupPanelModel";
import type { OcrSetupPanelModel } from "@/features/ocrCapture/ocrSetupPanelModel";
import { setupSchema } from "@/features/ocrCapture/schema";
import type { SetupFormValues } from "@/features/ocrCapture/schema";
import { useOcrSetupOptions } from "@/features/ocrCapture/useOcrSetupOptions";

type OcrSetupResolution = { kind: "ready"; value: SetupFormValues } | { kind: "blocked" };

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

  const validation = setupSchema.safeParse(value);
  const resolution: OcrSetupResolution =
    options.ready && validation.success ? { kind: "ready", value } : { kind: "blocked" };
  const blockedReason = enabled
    ? options.loading || options.refreshing
      ? "試合設定の選択肢を確認しています。"
      : validation.success
        ? undefined
        : (validation.error.issues[0]?.message ?? "試合設定を確認してください。")
    : "ログイン状態を確認中です。";
  const patchValue = (patch: Partial<SetupFormValues>) => {
    setValue((current) => ({ ...current, ...patch }));
  };
  const panel: OcrSetupPanelModel = {
    fields: buildOcrSetupPanelFields({ enabled, options, value }),
    intents: {
      changeGameTitle: (gameTitleId) =>
        patchValue({ gameTitleId, mapMasterId: "", seasonMasterId: "" }),
      changeHeldEvent: (heldEventId, selected) =>
        patchValue({ heldEventId, matchNoInEvent: selected?.nextMatchNo }),
      changeHeldEventPage: options.heldEventPicker.onPageChange,
      changeMap: (mapMasterId) => patchValue({ mapMasterId }),
      changeMatchNo: (nextValue) =>
        patchValue({
          matchNoInEvent: nextValue ? Math.trunc(Number(nextValue)) : undefined,
        }),
      changeOwner: (ownerMemberId) => patchValue({ ownerMemberId }),
      changeSeason: (seasonMasterId) => patchValue({ seasonMasterId }),
    },
  };

  return { blockedReason, options, panel, resolution, value };
}
