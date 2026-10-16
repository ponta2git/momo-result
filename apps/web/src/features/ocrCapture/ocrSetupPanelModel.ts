import type { SetupFormValues } from "@/features/ocrCapture/schema";
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

type NamedOption = { id: string; name: string };

type SetupPanelOptions = {
  gameTitles: readonly NamedOption[];
  gameTitlesError: string | undefined;
  gameTitlesPlaceholder: string;
  heldEventPicker: {
    error: string | undefined;
    heldEvents: HeldEventResponse[];
    pagination: PaginationState | undefined;
    pending: boolean;
    scopeChanging: boolean;
    selectedHeldEvent: HeldEventResponse | undefined;
  };
  heldEventsError: string | undefined;
  heldEventsPlaceholder: string;
  mapMasters: readonly NamedOption[];
  mapMastersError: string | undefined;
  mapMastersPlaceholder: string;
  seasonMasters: readonly NamedOption[];
  seasonMastersError: string | undefined;
  seasonMastersPlaceholder: string;
  selectedHeldEvent: HeldEventResponse | undefined;
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

function selectOptions(items: readonly NamedOption[], placeholder: string): SelectOption[] {
  return items.length === 0
    ? [{ label: placeholder, value: "" }]
    : items.map((item) => ({ label: item.name, value: item.id }));
}

/** Projects resolved choices and the current input into the fields rendered by SetupPanel. */
export function buildOcrSetupPanelFields({
  enabled,
  options,
  value,
}: {
  enabled: boolean;
  options: SetupPanelOptions;
  value: SetupFormValues;
}): OcrSetupPanelModel["fields"] {
  return {
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
  };
}
