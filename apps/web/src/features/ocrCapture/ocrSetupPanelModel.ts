import type { SetupFormValues } from "@/features/ocrCapture/schema";
import type { OcrSetupOptions } from "@/features/ocrCapture/useOcrSetupOptions";
import type { HeldEventResponse } from "@/shared/api/heldEvents";
import { canonicalResultMembers } from "@/shared/domain/members";
import type { PaginationState } from "@/shared/lib/pagination";

type SelectOption = {
  label: string;
  value: string;
};

type SetupSelectFieldModel = {
  disabled?: boolean | undefined;
  error?: string | undefined;
  options: SelectOption[];
  value: string;
};

export type OcrSetupPanelModel = {
  fields: {
    gameTitle: SetupSelectFieldModel;
    heldEvent: {
      disabled: boolean;
      error: string | undefined;
      heldEvents: HeldEventResponse[];
      pagination: PaginationState | undefined;
      pending: boolean;
      scopeChanging: boolean;
      selectedHeldEvent: HeldEventResponse | undefined;
      unavailableLabel: string;
      value: string;
    };
    map: SetupSelectFieldModel;
    matchNo: {
      disabled: boolean;
      value: number | "";
    };
    owner: SetupSelectFieldModel;
    season: SetupSelectFieldModel;
  };
  intents: {
    changeGameTitle: (gameTitleId: string) => void;
    changeHeldEvent: (heldEventId: string, selected: HeldEventResponse | undefined) => void;
    changeHeldEventPage: (page: number) => void;
    changeMap: (mapMasterId: string) => void;
    changeMatchNo: (value: string) => void;
    changeOwner: (ownerMemberId: string) => void;
    changeSeason: (seasonMasterId: string) => void;
  };
};

const ownerOptions = canonicalResultMembers.map((member) => ({
  label: member.displayName,
  value: member.memberId,
}));

function selectOptions(
  items: Array<{ id: string; name: string }>,
  placeholder: string,
): SelectOption[] {
  return items.length === 0
    ? [{ label: placeholder, value: "" }]
    : items.map((item) => ({ label: item.name, value: item.id }));
}

/** Adapts setup query data and form state to the fields and intents rendered by SetupPanel. */
export function buildOcrSetupPanelModel({
  enabled,
  options,
  setValue,
  value,
}: {
  enabled: boolean;
  options: OcrSetupOptions;
  setValue: (value: SetupFormValues) => void;
  value: SetupFormValues;
}): OcrSetupPanelModel {
  const patchValue = (patch: Partial<SetupFormValues>) => {
    setValue({ ...value, ...patch });
  };

  return {
    fields: {
      gameTitle: {
        disabled: !enabled || options.gameTitles.length === 0,
        error: options.gameTitlesError,
        options: selectOptions(options.gameTitles, options.gameTitlesPlaceholder),
        value: value.gameTitleId,
      },
      heldEvent: {
        disabled: !enabled,
        error: options.heldEventPicker.error ?? options.heldEventsError,
        heldEvents: options.heldEventPicker.heldEvents,
        pagination: options.heldEventPicker.pagination,
        pending: options.heldEventPicker.pending,
        scopeChanging: options.heldEventPicker.scopeChanging,
        selectedHeldEvent: options.heldEventPicker.selectedHeldEvent ?? options.selectedHeldEvent,
        unavailableLabel: options.heldEventsPlaceholder,
        value: value.heldEventId ?? "",
      },
      map: {
        disabled: !enabled || options.mapMasters.length === 0,
        error: options.mapMastersError,
        options: selectOptions(options.mapMasters, options.mapMastersPlaceholder),
        value: value.mapMasterId,
      },
      matchNo: {
        disabled: !enabled || !value.heldEventId,
        value: value.matchNoInEvent ?? "",
      },
      owner: {
        options: ownerOptions,
        value: value.ownerMemberId,
      },
      season: {
        disabled: !enabled || options.seasonMasters.length === 0,
        error: options.seasonMastersError,
        options: selectOptions(options.seasonMasters, options.seasonMastersPlaceholder),
        value: value.seasonMasterId,
      },
    },
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
}
