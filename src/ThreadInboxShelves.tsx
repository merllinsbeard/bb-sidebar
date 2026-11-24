import { useListMotion } from "./useListMotion";
import { useMemo } from "react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { InboxThreadOptions } from "./InboxThreadRenderer";
import { Icon } from "./components/Icon";
import { cn } from "./lib/utils";
import { ProjectFavicon, ProjectStripe } from "./ProjectFavicon";
import { useProjectColor } from "./ProjectColors";
import type { ThreadReorderControls } from "./ThreadCard";
import { SlimRow } from "./SlimRow";
import { CleanSettledDialog } from "./CleanSettledDialog";
import { TRAILING_GLYPH_BOX_CLASS } from "./StatusSlot";
import { projectIconUrl } from "./project-icons";
import type { GroupAlert, ProjectViewUnit } from "./inbox-layout";
import { DRAG_LIFT_CLASS } from "./drag-preview";
import { GroupAlertDots, groupAlertPhrase } from "./GroupAlertDots";
import { environmentLabel } from "./environment-groups";
import { useInboxEnvironment, useInboxActions, useInboxActivity } from "./InboxContext";

export const SETTLED_PAGE_SIZE = 25;

/**
 * A collapsed shelf of parked threads. The header stays while anything is
 * parked — the count is the whole footprint when collapsed — and the shelf
 * vanishes entirely at zero.
 */
export function CompactShelf({
  label,
  threads,
  expanded,
  onToggle,
  shelf,
  visibleThreads,
  settledLimit,
  onLoadMore,
  expandedChildParentIds,
}: {
  label: string;
  threads: readonly PluginSidebarThread[];
  expanded: boolean;
  onToggle: () => void;
  shelf: "parked" | "snoozed" | "settled";
  visibleThreads: readonly PluginSidebarThread[];
  settledLimit?: number;
  onLoadMore?: () => void;
  expandedChildParentIds: ReadonlySet<string>;
}) {
  const { lifecycle } = useInboxEnvironment();
  const { activeThreadId, now: clockNow } = useInboxActivity();
  const { onNavigate } = useInboxActions();
  const attachListMotionRef = useListMotion<HTMLUListElement>();
  const now = useMemo(() => Date.now(), [clockNow, visibleThreads]);
  if (threads.length === 0 && shelf !== "settled") return null;
  const limit = shelf === "settled" ? (settledLimit ?? threads.length) : threads.length;
  const hasMore = shelf === "settled" && threads.length > limit;
  return (
    <CollapsibleShelf
      label={label}
      hidden={threads.length === 0}
      count={threads.length}
      expanded={expanded}
      onToggle={onToggle}
      action={
        shelf === "settled" ? (
          <CleanSettledDialog threadIds={threads.map((thread) => thread.id)} onNavigate={onNavigate} />
        ) : undefined
      }
    >
      <ul ref={attachListMotionRef} className="flex flex-col gap-px">
        {visibleThreads.map((thread) => (
          <SlimRow
            key={thread.id}
            thread={thread}
            isActive={thread.id === activeThreadId}
            shelf={shelf}
            parkedAt={lifecycle.parkedAtFor(thread)}
            wakeAt={lifecycle.wakeAtFor(thread)}
            now={now}
            childrenExpanded={expandedChildParentIds.has(thread.id)}
          />
        ))}
      </ul>
      {expanded && hasMore && onLoadMore ? (
        <button
          type="button"
          onClick={onLoadMore}
          className="ml-2 mt-1 rounded-md px-2 py-1 text-xs font-normal text-subtle-foreground hover:bg-state-hover hover:text-sidebar-foreground"
        >
          Load {Math.min(SETTLED_PAGE_SIZE, threads.length - limit)} more
        </button>
      ) : null}
    </CollapsibleShelf>
  );
}

/**
 * The shelves as one scrolling list. Docked, the list fills at least the
 * sidebar's height and the shelves after Active take the space left over at
 * the top of their group, so while they are short they rest at the bottom;
 * an open shelf longer than the room simply extends the list, and everything
 * scrolls together. T3 Code's sidebar anchors its shelves the same way.
 */
export function DockableShelves({
  docked,
  hasLower = true,
  upper,
  lower,
  attachUpperRef,
  attachLowerRef,
}: {
  docked: boolean;
  hasLower?: boolean;
  upper: React.ReactNode;
  lower: React.ReactNode;
  attachUpperRef: (node: HTMLDivElement | null) => void;
  attachLowerRef: (node: HTMLDivElement | null) => void;
}) {
  if (!docked) {
    return (
      <div ref={attachUpperRef} className="flex flex-col">
        {upper}
        {lower}
      </div>
    );
  }
  return (
    <div className="flex min-h-full flex-col">
      <div ref={attachUpperRef} className="flex flex-col">
        {upper}
      </div>
      <div
        ref={attachLowerRef}
        data-shelf-dock=""
        className={cn("mt-auto flex flex-col", hasLower && "border-t border-sidebar-border/40 pt-1")}
      >
        {lower}
      </div>
    </div>
  );
}

export function CollapsibleShelf({
  label,
  count,
  expanded,
  onToggle,
  action,
  children,
  hidden = false,
}: {
  label: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  action?: React.ReactNode;
  children: React.ReactNode;
  hidden?: boolean;
}) {
  return (
    <section aria-label={label} hidden={hidden} className="mt-2 first:mt-0.5">
      <div className="relative">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-label={expanded ? label : `${label} (${count})`}
          className="flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-left text-xs font-normal leading-5 text-subtle-foreground/75 transition-colors hover:text-sidebar-foreground"
        >
          <span className="min-w-0 truncate">{label}</span>
          <span className="shrink-0 text-xs font-normal tabular-nums text-subtle-foreground/60">{count}</span>
          <span className="flex-1" />
          {action ? <span aria-hidden="true" className="size-6 shrink-0" /> : null}
          <HeaderChevron expanded={expanded} className="text-subtle-foreground" />
        </button>
        {action}
      </div>
      {children}
    </section>
  );
}

/** A shelf's or group's folding chevron, on the same axis as every row's trailing glyph. */
export function HeaderChevron({ expanded, className }: { expanded: boolean; className: string }) {
  return (
    <span className={TRAILING_GLYPH_BOX_CLASS}>
      <Icon
        name="ChevronDown"
        aria-hidden
        className={cn(
          "size-3.5 transition-transform duration-150 ease-out motion-reduce:transition-none",
          className,
          expanded && "rotate-180",
        )}
      />
    </span>
  );
}

function ActiveProjectGroup({
  unitKey,
  projectId,
  projectName,
  projectIconUrl,
  threadCount,
  alerts,
  expanded,
  onToggle,
  reorder,
  children,
}: {
  unitKey: string;
  projectId: string;
  projectName: string;
  projectIconUrl: string | null;
  threadCount: number;
  alerts: readonly GroupAlert[];
  expanded: boolean;
  onToggle: () => void;
  reorder: ThreadReorderControls;
  children: React.ReactNode;
}) {
  const stripeView = expanded ? "group-full" : "group-collapsed";
  const projectColor = useProjectColor(projectId);
  const attachListMotionRef = useListMotion<HTMLUListElement>();
  return (
    // One item of the top-level list, so the whole project is a single drop
    // target when projects are dragged around each other.
    <li
      data-reorder-unit={unitKey}
      className={cn("list-none rounded-md", reorder.isDragging && ["relative z-20", DRAG_LIFT_CLASS])}
    >
      <section data-drag-visual="" className="relative" aria-label={`${projectName} project`}>
        <ProjectStripe projectId={projectId} view={stripeView} className="z-10" />
        <button
          type="button"
          data-reorder-key={unitKey}
          onClick={onToggle}
          onPointerDown={reorder.onPointerDown}
          onKeyDown={reorder.onKeyDown}
          aria-expanded={expanded}
          aria-label={`${projectName} (${threadCount})${groupAlertPhrase(alerts)}`}
          aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
          className={cn(
            "flex h-7 w-full touch-pan-y items-center gap-1.5 rounded-md px-2 text-left text-xs font-normal leading-5 text-subtle-foreground/75 transition-colors hover:text-sidebar-foreground",
            !reorder.disabled && "cursor-grab active:cursor-grabbing",
          )}
        >
          <ProjectFavicon projectId={projectId} src={projectIconUrl} name={projectName} className="size-3.5" />
          <span
            style={projectColor}
            className={cn(
              "min-w-0 truncate text-xs font-normal leading-5",
              projectColor ? "bb-sidebar-project-name" : "text-subtle-foreground/75",
            )}
          >
            {projectName}
          </span>
          <span className="shrink-0 text-xs font-normal tabular-nums text-subtle-foreground/60">{threadCount}</span>
          <GroupAlertDots alerts={alerts} />
          <span className="flex-1" />
          <HeaderChevron expanded={expanded} className="text-subtle-foreground" />
        </button>
        <ul ref={attachListMotionRef} aria-label={`${projectName} active threads`} className="flex flex-col gap-px">
          {children}
        </ul>
      </section>
    </li>
  );
}

function EnvironmentGroup({
  unit,
  onToggle,
  reorder,
  children,
}: {
  unit: Extract<ProjectViewUnit, { kind: "group" }>;
  onToggle: () => void;
  reorder: ThreadReorderControls;
  children: React.ReactNode;
}) {
  const attachListRef = useListMotion<HTMLUListElement>();
  const environment = unit.environment!;
  const label = environmentLabel(environment);
  const host = unit.threads.find((thread) => thread.host)?.host;
  return (
    <li
      data-reorder-unit={unit.key}
      className={cn("list-none rounded-md", reorder.isDragging && ["relative z-20", DRAG_LIFT_CLASS])}
    >
      <section data-drag-visual="" aria-label={`${label} worktree`}>
        <button
          type="button"
          data-reorder-key={unit.key}
          aria-expanded={unit.expanded}
          aria-label={`${label} (${unit.threadCount})${groupAlertPhrase(unit.alerts)}`}
          aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
          title={[environment.name, environment.path, host?.name].filter(Boolean).join("\n")}
          onClick={onToggle}
          onPointerDown={reorder.onPointerDown}
          onKeyDown={reorder.onKeyDown}
          className={cn(
            "flex h-7 w-full touch-pan-y items-center gap-1.5 rounded-md px-2 text-left text-xs font-normal leading-5 text-subtle-foreground/75 transition-colors hover:text-sidebar-foreground",
            !reorder.disabled && "cursor-grab active:cursor-grabbing",
          )}
        >
          <Icon name="FolderGit" className="size-3.5 shrink-0 text-subtle-foreground/75" aria-hidden />
          <span className="min-w-0 truncate font-mono">{label}</span>
          <span className="shrink-0 tabular-nums text-subtle-foreground/60">{unit.threadCount}</span>
          <GroupAlertDots alerts={unit.alerts} />
          <span className="flex-1" />
          <HeaderChevron expanded={unit.expanded} className="text-subtle-foreground" />
        </button>
        <ul
          ref={attachListRef}
          aria-label={`${label} active threads`}
          className="ml-2 flex flex-col gap-px border-l border-sidebar-border/60 pl-1"
        >
          {children}
        </ul>
      </section>
    </li>
  );
}

/** Lone threads and whole projects, in one list so either can pass the other. */
export function ProjectGroups({
  units,
  reorderControls,
  renderThread,
  onToggleEnvironment,
}: {
  units: readonly ProjectViewUnit[];
  reorderControls: (unit: Extract<ProjectViewUnit, { kind: "group" }>, projectName: string) => ThreadReorderControls;
  renderThread: (thread: PluginSidebarThread, options?: InboxThreadOptions) => React.ReactNode;
  onToggleEnvironment: (key: string) => void;
}) {
  const { projectNameById, projectIconRevision } = useInboxEnvironment();
  const { toggleProjectCollapse: onToggle } = useInboxActions();
  const attachListMotionRef = useListMotion<HTMLUListElement>();
  if (units.length === 0) return null;
  return (
    <ul ref={attachListMotionRef} className="flex flex-col gap-px">
      {units.map((unit) => {
        if (unit.kind === "thread") return renderThread(unit.thread);
        const projectName = projectNameById.get(unit.projectId) ?? "Project";
        return (
          <ActiveProjectGroup
            key={unit.key}
            unitKey={unit.key}
            projectId={unit.projectId}
            projectName={projectName}
            projectIconUrl={projectIconUrl(unit.projectId, projectIconRevision)}
            threadCount={unit.threadCount}
            alerts={unit.alerts}
            expanded={unit.expanded}
            onToggle={() => onToggle(unit.projectId)}
            reorder={reorderControls(unit, projectName)}
          >
            {unit.children
              ? unit.children.map((child) =>
                  child.kind === "thread" ? (
                    renderThread(child.thread, { showProject: false })
                  ) : (
                    <EnvironmentGroup
                      key={child.key}
                      unit={child}
                      onToggle={() => onToggleEnvironment(child.key)}
                      reorder={reorderControls(child, environmentLabel(child.environment!))}
                    >
                      {child.threads.map((thread) =>
                        renderThread(thread, {
                          showProject: false,
                          showEnvironment: false,
                          showChildAttention: child.expanded,
                        }),
                      )}
                    </EnvironmentGroup>
                  ),
                )
              : unit.threads.map((thread) =>
                  renderThread(thread, { showProject: false, showChildAttention: unit.expanded }),
                )}
          </ActiveProjectGroup>
        );
      })}
    </ul>
  );
}

export function Shelf({ label, children }: { label: string | null; children: React.ReactNode }) {
  const attachListMotionRef = useListMotion<HTMLUListElement>();
  return (
    // A named section is exposed as a landmark region; shelf rows stay in an
    // unnamed list beneath their collapsible heading.
    <section {...(label ? { "aria-label": label } : {})}>
      {label ? (
        <h2 className="flex h-7 items-center px-2 text-xs font-normal leading-5 text-subtle-foreground/75">{label}</h2>
      ) : null}
      <ul ref={attachListMotionRef} className="flex flex-col gap-px">
        {children}
      </ul>
    </section>
  );
}
