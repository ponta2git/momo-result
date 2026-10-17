import {
  buildHeldEventsListView,
  buildHeldEventsActionView,
} from "@/features/heldEvents/list/heldEventsListPresentation";
import { useHeldEventActions } from "@/features/heldEvents/list/useHeldEventActions";
import { useHeldEventsList } from "@/features/heldEvents/list/useHeldEventsList";

/** Composes list navigation/read state and held-event creation and deletion into one screen. */
export function useHeldEvents() {
  const directory = useHeldEventsList();
  const actions = useHeldEventActions();
  const list = buildHeldEventsListView(
    directory.snapshot,
    directory.refresh,
    {
      onPageChange: directory.updatePage,
      onPageSizeChange: directory.updatePageSize,
      onRequestDelete: actions.requestDelete,
    },
    actions.deleteDialog.pending,
  );
  return {
    create: actions.create,
    deleteDialog: actions.deleteDialog,
    list,
    actionView: buildHeldEventsActionView({
      list,
      create: actions.create,
      deleteDialog: actions.deleteDialog,
      refresh: directory.refresh,
      errorMessage: actions.errorMessage,
    }),
    navigationGuard: actions.navigationGuard,
    openCreate: actions.openCreate,
    refresh: directory.refresh,
  } as const;
}
