import { buildHeldEventsActionView } from "@/features/heldEvents/list/heldEventsListPresentation";
import { useHeldEventActions } from "@/features/heldEvents/list/useHeldEventActions";
import { useHeldEventsList } from "@/features/heldEvents/list/useHeldEventsList";

/** Composes the searchable list and held-event creation and deletion into one screen. */
export function useHeldEvents() {
  const directory = useHeldEventsList();
  const actions = useHeldEventActions();
  const actionView = buildHeldEventsActionView({
    create: actions.create,
    deleteDialog: actions.deleteDialog,
    errorMessage: actions.errorMessage,
  });
  const { list } = directory;
  return {
    actionView,
    create: actions.create,
    deleteDialog: actions.deleteDialog,
    filters: directory.filters,
    list: {
      ...list,
      // Deleting needs a current row: not one retained from another search or a failed refresh.
      deleteDisabled: actions.deleteDialog.pending || list.stale || list.scopeChanging,
      onRequestDelete: actions.requestDelete,
    },
    navigationGuard: actions.navigationGuard,
    openCreate: actions.openCreate,
    refresh: {
      disabled: directory.refresh.pending || actionView.dialogPending,
      pending: directory.refresh.pending,
      run: directory.refresh.run,
    },
  } as const;
}
