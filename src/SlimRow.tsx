import { memo, useId, useState } from "react";
import { useSidebarThreadShortcut, type PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { Icon } from "./components/Icon";
import { Tooltip } from "./components/Tooltip";
import { ChildThreadBadge, ChildThreadList, collapsedChildThreads } from "./ChildThreadList";
import { CompactRow } from "./CompactRow";
import { ProviderGlyph } from "./ProviderGlyph";
import { RowContextMenu } from "./RowContextMenu";
import { StatusOrTime, useStatusLimit, useWorkingForDisplay } from "./StatusSlot";
import { threadDisplayTitle } from "./inbox";
import { snoozeWakeLabel } from "./lifecycle";
import { useProjectColor } from "./ProjectColors";
import { OpenPortsIndicator } from "./OpenPorts";
import { ShortcutHint } from "./bb-sdk";
import { rowKeyshortcuts } from "./lib/keyshortcuts";
import { cn } from "./lib/utils";
import { useInboxActivity, useInboxEnvironment, useInboxActions } from "./InboxContext";
import { useRowStatusRuns } from "./useLifecycle";
import { projectIconUrl as iconUrl } from "./project-icons";

/**
 * A parked, snoozed, or settled thread: one line instead of a card, with its
 * children behind the same chip as a compact card. Density comes from the user
 * actually parking work, never from the sidebar guessing what still matters.
 *
 * Same structure as the card — a full-bleed anchor under the restore button,
 * because a `<button>` inside an `<a>` is invalid interactive nesting.
 */
export const SlimRow = memo(function SlimRow({
  thread,
  isActive,
  shelf,
  parkedAt,
  wakeAt,
  now,
  childrenExpanded,
}: {
  thread: PluginSidebarThread;
  isActive: boolean;
  shelf: "parked" | "snoozed" | "settled";
  parkedAt?: number | null;
  wakeAt: number | null;
  now: number;
  childrenExpanded: boolean;
}) {
  const {
    providerById,
    projectNameById,
    personalProjectIds,
    sectionById,
    sectionColorById,
    projectIconRevision,
    snoozePresets,
    lifecycle,
    childrenByParentId,
  } = useInboxEnvironment();
  const provider = providerById.get(thread.providerId) ?? null;
  const { onNavigate, parkThread, settleThread, snoozeThread, toggleChildExpansion } = useInboxActions();
  const { activeThreadId } = useInboxActivity();
  const childThreads = childrenByParentId.get(thread.id) ?? [];
  const childListId = useId();
  const isWorking = useWorkingForDisplay();
  // Shelved rows stay one line: children show only when expanded, or on the
  // way to the open thread, never because one needs attention.
  const showChildren =
    childThreads.length > 0 &&
    (childrenExpanded ||
      collapsedChildThreads(childThreads, childrenByParentId, activeThreadId, false, isWorking).length > 0);
  // Another plugin's running status keeps the thread where it is.
  const canShelve = !useRowStatusRuns(thread.id);
  const projectName = projectNameById.get(thread.projectId) ?? null;
  const showProject = !personalProjectIds.has(thread.projectId);
  const section = thread.sectionId ? (sectionById.get(thread.sectionId) ?? null) : null;
  const sectionColor = section ? sectionColorById.get(section.id) : undefined;
  const projectIconUrl = iconUrl(thread.projectId, projectIconRevision);
  const onPark = () => parkThread(thread);
  const onSettle = () => settleThread(thread);
  const onSnooze = (until: number) => snoozeThread(thread, until);
  const onRestore = () =>
    shelf === "parked"
      ? void lifecycle.resume(thread.id)
      : shelf === "snoozed"
        ? void lifecycle.unsnooze(thread.id)
        : void lifecycle.unsettle(thread.id);
  const projectColor = useProjectColor(thread.projectId);
  const shortcut = useSidebarThreadShortcut(thread.id);
  const title = threadDisplayTitle(thread);
  const labelPrefix = showProject ? projectName : (section?.name ?? null);
  const rowLabel = labelPrefix ? `${labelPrefix} · ${title}` : title;
  const [isRenaming, setIsRenaming] = useState(false);
  const limit = useStatusLimit(thread);

  return (
    <RowContextMenu
      thread={thread}
      onPark={canShelve && shelf !== "parked" ? onPark : undefined}
      onResume={shelf === "parked" ? onRestore : undefined}
      onSettle={canShelve && shelf !== "settled" ? onSettle : undefined}
      canSnooze={canShelve && shelf !== "snoozed"}
      snoozePresets={snoozePresets}
      onSnooze={onSnooze}
      onWake={shelf === "snoozed" ? onRestore : undefined}
      onUnsettle={shelf === "settled" ? onRestore : undefined}
      onRename={() => setIsRenaming(true)}
    >
      <li className="list-none">
        <CompactRow
          thread={thread}
          tone="muted"
          showProject={showProject}
          projectName={projectName}
          projectIconUrl={projectIconUrl}
          projectColor={projectColor}
          sectionName={section?.name ?? null}
          sectionColor={sectionColor}
          label={rowLabel}
          isActive={isActive}
          isRenaming={isRenaming}
          onRenamingChange={setIsRenaming}
          linkProps={{ "aria-keyshortcuts": rowKeyshortcuts(shortcut?.ariaKeyshortcuts, false) }}
          onOpen={onNavigate}
          leading={
            <ProviderGlyph
              providerId={thread.providerId}
              provider={provider}
              className={cn(!isActive && "opacity-75 group-hover/slim:opacity-100")}
            />
          }
          trailing={
            <>
              <OpenPortsIndicator thread={thread} />
              {childThreads.length > 0 ? (
                // Positioned, so the chip sits above the row's full-bleed link.
                <span className="pointer-events-none relative flex shrink-0 items-center">
                  <ChildThreadBadge
                    threads={childThreads}
                    childrenByParent={childrenByParentId}
                    expanded={childrenExpanded}
                    controls={childListId}
                    onToggle={() => toggleChildExpansion(thread.id)}
                  />
                </span>
              ) : null}
              {/* Size to the label so the port icon stays beside it. Keep enough
              room for the restore button, which replaces the label on hover.
              On touch devices, show both side by side. */}
              {shortcut ? (
                <ShortcutHint shortcut={shortcut} />
              ) : limit ? (
                <StatusOrTime thread={thread} now={now} />
              ) : (
                <span className="pointer-events-none relative flex min-w-6 shrink-0 items-center justify-end tabular-nums text-xs text-subtle-foreground [@media(hover:none)]:gap-2">
                  <span className="flex items-center transition-opacity duration-150 ease-out [@media(hover:hover)]:group-hover/slim:opacity-0 motion-reduce:transition-none">
                    {shelf === "parked" && parkedAt != null ? (
                      `Waiting ${Math.max(0, Math.floor((now - parkedAt) / 86_400_000))}d`
                    ) : shelf === "snoozed" && wakeAt !== null ? (
                      snoozeWakeLabel(wakeAt, now)
                    ) : (
                      <StatusOrTime thread={thread} now={now} />
                    )}
                  </span>
                  <Tooltip
                    label={
                      shelf === "parked"
                        ? "Resume thread"
                        : shelf === "snoozed"
                          ? "Wake thread now"
                          : "Un-settle thread"
                    }
                  >
                    <button
                      type="button"
                      aria-label={
                        shelf === "parked"
                          ? "Resume thread"
                          : shelf === "snoozed"
                            ? "Wake thread now"
                            : "Un-settle thread"
                      }
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        onRestore();
                      }}
                      className="pointer-events-auto absolute right-0 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-subtle-foreground opacity-0 transition-opacity duration-150 ease-out hover:bg-state-hover hover:text-sidebar-foreground focus-visible:opacity-100 group-hover/slim:opacity-100 [@media(hover:none)]:static [@media(hover:none)]:translate-y-0 [@media(hover:none)]:opacity-100 motion-reduce:transition-none"
                    >
                      <Icon name={shelf === "snoozed" ? "Clock" : "ArrowTurnBackward"} className="size-3.5" />
                    </button>
                  </Tooltip>
                </span>
              )}
            </>
          }
        />
        {showChildren ? (
          <ChildThreadList
            id={childListId}
            threads={childThreads}
            expanded={childrenExpanded}
            showRunningChildrenWhenCollapsed={false}
            parentProjectId={thread.projectId}
          />
        ) : null}
      </li>
    </RowContextMenu>
  );
});
