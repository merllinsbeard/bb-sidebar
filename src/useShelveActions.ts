import { useCallback } from "react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { LifecycleApi } from "./useLifecycle";
import { useSnoozeCommands } from "./useSnoozeCommands";

/**
 * The row actions that file a thread away, plus the palette commands that run
 * through them. Shelving leaves the current navigation untouched.
 */
export function useShelveActions({
  threads,
  scope,
  lifecycle,
}: {
  threads: readonly PluginSidebarThread[];
  scope: readonly string[];
  lifecycle: LifecycleApi;
}) {
  const parkActiveThread = useCallback(async (_thread: PluginSidebarThread, mutation: () => Promise<boolean>) => {
    await mutation();
  }, []);

  const parkThread = useCallback(
    (thread: PluginSidebarThread) => void parkActiveThread(thread, () => lifecycle.park(thread.id)),
    [parkActiveThread, lifecycle],
  );
  const settleThread = useCallback(
    (thread: PluginSidebarThread) => void parkActiveThread(thread, () => lifecycle.settle(thread.id)),
    [parkActiveThread, lifecycle],
  );
  const snoozeThread = useCallback(
    (thread: PluginSidebarThread, until: number) =>
      void parkActiveThread(thread, () => lifecycle.snooze(thread.id, until)),
    [parkActiveThread, lifecycle],
  );
  useSnoozeCommands(threads, scope, lifecycle, snoozeThread);

  return { parkThread, settleThread, snoozeThread };
}
