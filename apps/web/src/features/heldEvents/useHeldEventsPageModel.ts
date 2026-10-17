import {
  buildHeldEventsListModel,
  heldEventsPageControls,
} from "@/features/heldEvents/heldEventViewModel";
import { useHeldEventCommands } from "@/features/heldEvents/useHeldEventCommands";
import { useHeldEventsList } from "@/features/heldEvents/useHeldEventsList";

/** Composes list navigation/read state and the held-event commands into one screen. */
export function useHeldEventsPageModel() {
  const events = useHeldEventsList();
  const commands = useHeldEventCommands();
  const list = buildHeldEventsListModel(
    events.snapshot,
    events.refresh,
    {
      onPageChange: events.updatePage,
      onPageSizeChange: events.updatePageSize,
      onRequestDelete: commands.requestDelete,
    },
    commands.deleteDialog.pending,
  );
  return {
    create: commands.create,
    deleteDialog: commands.deleteDialog,
    list,
    controls: heldEventsPageControls({
      list,
      create: commands.create,
      deleteDialog: commands.deleteDialog,
      refresh: events.refresh,
      errorMessage: commands.errorMessage,
    }),
    navigationGuard: commands.navigationGuard,
    openCreate: commands.openCreate,
    refresh: events.refresh,
  } as const;
}
