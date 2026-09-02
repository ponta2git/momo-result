import type { ComponentProps } from "react";

import type { HeldEventPickerField } from "@/shared/heldEvents/HeldEventPickerField";
import type { DraftStatusBadgeProps } from "@/shared/matches/DraftStatusBadge";
import type { DecorativeActionIcon } from "@/shared/ui/actions/actionRecipes";
import type { ButtonProps } from "@/shared/ui/actions/Button";
import type { IconButtonProps } from "@/shared/ui/actions/IconButton";
import type { IconLinkProps } from "@/shared/ui/actions/IconLink";
import type { LinkButtonProps } from "@/shared/ui/actions/LinkButton";
import type { Disclosure } from "@/shared/ui/data/Collapsible";
import type { DataTable, DataTableBodyRow } from "@/shared/ui/data/DataTable";
import type { FactListProps } from "@/shared/ui/data/FactList";
import type { MatchResultLedger } from "@/shared/ui/data/MatchResultLedger";
import type { MemberSequenceLabel } from "@/shared/ui/data/MemberSequenceLabel";
import type { PaginationControlsProps } from "@/shared/ui/data/PaginationControls";
import type { PlayOrderMark } from "@/shared/ui/data/PlayOrderMark";
import type { DialogFooter } from "@/shared/ui/feedback/Dialog";
import type { EmptyStateProps } from "@/shared/ui/feedback/EmptyState";
import type { NoticeProps } from "@/shared/ui/feedback/Notice";
import type { PageLoadingFallbackProps } from "@/shared/ui/feedback/PageLoadingFallback";
import type { ProgressBar } from "@/shared/ui/feedback/ProgressBar";
import type { ResourcePageStateProps } from "@/shared/ui/feedback/ResourcePageState";
import type { SpinnerIcon } from "@/shared/ui/feedback/Spinner";
import type { Tooltip, TooltipProvider } from "@/shared/ui/feedback/Tooltip";
import type { CheckboxFieldProps } from "@/shared/ui/forms/CheckboxField";
import type { ChoiceListProps } from "@/shared/ui/forms/ChoiceList";
import type { ChoicePickerDialogField } from "@/shared/ui/forms/ChoicePickerDialogField";
import type {
  InputControlProps,
  SelectControlProps,
  TextareaControlProps,
} from "@/shared/ui/forms/Control";
import type { FieldProps } from "@/shared/ui/forms/Field";
import type { Fieldset } from "@/shared/ui/forms/Fieldset";
import type { FilterBarProps } from "@/shared/ui/forms/FilterBar";
import type { SegmentedControlProps } from "@/shared/ui/forms/SegmentedControl";
import type { SelectFieldProps } from "@/shared/ui/forms/SelectField";
import type { TabsListProps, TabsPanel, TabsRoot, TabsTabProps } from "@/shared/ui/forms/Tabs";
import type { TextFieldProps } from "@/shared/ui/forms/TextField";
import type { GlobalNav } from "@/shared/ui/layout/GlobalNav";
import type { PageHeader } from "@/shared/ui/layout/PageHeader";
import type { StaleShield } from "@/shared/ui/motion/StaleShield";
import type { RankBadge, RankTrail } from "@/shared/ui/rank/RankBadge";
import type { StatusBadgeProps } from "@/shared/ui/status/StatusBadge";

type ExternalVisualOverride<Props> = Extract<
  keyof Props,
  "className" | "style" | `${string}ClassName`
>;
type HasNoExternalVisualOverride<Props> =
  ExternalVisualOverride<Props> extends never ? true : false;
type Assert<Condition extends true> = Condition;

/**
 * Compile-time ownership contract for leaf UI. Layout primitives, Skeleton, data-viz geometry,
 * and dialog portal slots are intentional exceptions because allocating an area is their job.
 */
export type UiOwnershipContract = [
  Assert<"className" extends ExternalVisualOverride<{ className?: string }> ? true : false>,
  Assert<"style" extends ExternalVisualOverride<{ style?: object }> ? true : false>,
  Assert<
    "contentClassName" extends ExternalVisualOverride<{ contentClassName?: string }> ? true : false
  >,
  Assert<HasNoExternalVisualOverride<ComponentProps<typeof HeldEventPickerField>>>,
  Assert<HasNoExternalVisualOverride<ButtonProps>>,
  Assert<HasNoExternalVisualOverride<LinkButtonProps>>,
  Assert<HasNoExternalVisualOverride<IconButtonProps>>,
  Assert<HasNoExternalVisualOverride<IconLinkProps>>,
  Assert<HasNoExternalVisualOverride<ComponentProps<typeof DecorativeActionIcon>>>,
  Assert<HasNoExternalVisualOverride<ComponentProps<typeof Disclosure>>>,
  Assert<HasNoExternalVisualOverride<ComponentProps<typeof DataTable>>>,
  Assert<HasNoExternalVisualOverride<ComponentProps<typeof DataTableBodyRow>>>,
  Assert<HasNoExternalVisualOverride<FactListProps>>,
  Assert<HasNoExternalVisualOverride<ComponentProps<typeof MatchResultLedger>>>,
  Assert<HasNoExternalVisualOverride<ComponentProps<typeof MemberSequenceLabel>>>,
  Assert<HasNoExternalVisualOverride<PaginationControlsProps>>,
  Assert<HasNoExternalVisualOverride<ComponentProps<typeof PlayOrderMark>>>,
  Assert<HasNoExternalVisualOverride<ComponentProps<typeof DialogFooter>>>,
  Assert<HasNoExternalVisualOverride<EmptyStateProps>>,
  Assert<HasNoExternalVisualOverride<NoticeProps>>,
  Assert<HasNoExternalVisualOverride<PageLoadingFallbackProps>>,
  Assert<HasNoExternalVisualOverride<ComponentProps<typeof ProgressBar>>>,
  Assert<HasNoExternalVisualOverride<ResourcePageStateProps>>,
  Assert<HasNoExternalVisualOverride<ComponentProps<typeof SpinnerIcon>>>,
  Assert<HasNoExternalVisualOverride<ComponentProps<typeof Tooltip>>>,
  Assert<HasNoExternalVisualOverride<ComponentProps<typeof TooltipProvider>>>,
  Assert<HasNoExternalVisualOverride<CheckboxFieldProps>>,
  Assert<HasNoExternalVisualOverride<ChoiceListProps>>,
  Assert<HasNoExternalVisualOverride<ComponentProps<typeof ChoicePickerDialogField>>>,
  Assert<HasNoExternalVisualOverride<InputControlProps>>,
  Assert<HasNoExternalVisualOverride<SelectControlProps>>,
  Assert<HasNoExternalVisualOverride<TextareaControlProps>>,
  Assert<HasNoExternalVisualOverride<FieldProps>>,
  Assert<HasNoExternalVisualOverride<ComponentProps<typeof Fieldset>>>,
  Assert<HasNoExternalVisualOverride<FilterBarProps>>,
  Assert<HasNoExternalVisualOverride<SegmentedControlProps>>,
  Assert<HasNoExternalVisualOverride<SelectFieldProps>>,
  Assert<HasNoExternalVisualOverride<TabsListProps>>,
  Assert<HasNoExternalVisualOverride<ComponentProps<typeof TabsPanel>>>,
  Assert<HasNoExternalVisualOverride<ComponentProps<typeof TabsRoot>>>,
  Assert<HasNoExternalVisualOverride<TabsTabProps>>,
  Assert<HasNoExternalVisualOverride<TextFieldProps>>,
  Assert<HasNoExternalVisualOverride<ComponentProps<typeof GlobalNav>>>,
  Assert<HasNoExternalVisualOverride<ComponentProps<typeof PageHeader>>>,
  Assert<HasNoExternalVisualOverride<ComponentProps<typeof StaleShield>>>,
  Assert<HasNoExternalVisualOverride<ComponentProps<typeof RankBadge>>>,
  Assert<HasNoExternalVisualOverride<ComponentProps<typeof RankTrail>>>,
  Assert<HasNoExternalVisualOverride<DraftStatusBadgeProps>>,
  Assert<HasNoExternalVisualOverride<StatusBadgeProps>>,
];
