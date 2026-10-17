import {
  buildHeldEventsListView,
  heldEventsPageControls,
} from "@/features/heldEvents/list/heldEventsListPresentation";
import { useHeldEventActions } from "@/features/heldEvents/list/useHeldEventActions";
import { useHeldEventsList } from "@/features/heldEvents/list/useHeldEventsList";

/** Composes list navigation/read state and held-event creation and deletion into one screen. */
export function useHeldEventsPageModel() {
  const events = useHeldEventsList();
  const actions = useHeldEventActions();
  const list = buildHeldEventsListView(
    events.snapshot,
    events.refresh,
    {
      onPageChange: events.updatePage,
      onPageSizeChange: events.updatePageSize,
      onRequestDelete: actions.requestDelete,
    },
    actions.deleteDialog.pending,
  );
  return {
    create: actions.create,
    deleteDialog: actions.deleteDialog,
    list,
    controls: heldEventsPageControls({
      list,
      create: actions.create,
      deleteDialog: actions.deleteDialog,
      refresh: events.refresh,
      errorMessage: actions.errorMessage,
    }),
    navigationGuard: actions.navigationGuard,
    openCreate: actions.openCreate,
    refresh: events.refresh,
  } as const;
}
