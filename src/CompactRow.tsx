import type { ComponentProps, CSSProperties, HTMLAttributes, ReactNode } from "react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { InlineThreadTitle } from "./InlineThreadTitle";
import { ProjectFavicon, ProjectStripe } from "./ProjectFavicon";
import { SectionBadge } from "./SectionBadge";
import { ThreadDetailsTooltip } from "./ThreadDetailsTooltip";
import { cn } from "./lib/utils";
import { DRAG_LIFT_CLASS } from "./drag-preview";

/** Shared one-line layout; callers own navigation, menus, and trailing actions. */
export function CompactRow({
  thread,
  tone,
  showProject = true,
  projectIconOnly = false,
  projectName,
  projectIconUrl,
  projectColor,
  sectionName = null,
  sectionColor,
  label,
  isActive,
  isSplitOpen = false,
  isDragging = false,
  isRenaming,
  onRenamingChange,
  onOpen,
  rowProps,
  linkProps,
  beforeContent,
  leading,
  fadeContent = false,
  trailing,
}: {
  thread: PluginSidebarThread;
  tone: "normal" | "muted";
  showProject?: boolean;
  projectIconOnly?: boolean;
  projectName: string | null;
  projectIconUrl: string;
  projectColor?: CSSProperties;
  sectionName?: string | null;
  sectionColor?: CSSProperties;
  label: string;
  isActive: boolean;
  isSplitOpen?: boolean;
  isDragging?: boolean;
  isRenaming: boolean;
  onRenamingChange: (editing: boolean) => void;
  /** Runs on a click that bb's link routing opens; it does not navigate. */
  onOpen: () => void;
  rowProps?: HTMLAttributes<HTMLDivElement> & Record<`data-${string}`, string | undefined>;
  linkProps?: Pick<
    ComponentProps<"a">,
    "draggable" | "aria-keyshortcuts" | "onPointerDown" | "onKeyDown" | "className"
  >;
  beforeContent?: ReactNode;
  leading?: ReactNode;
  fadeContent?: boolean;
  trailing: ReactNode;
}) {
  const muted = tone === "muted";
  return (
    <div
      data-compact-row=""
      {...rowProps}
      className={cn(
        muted ? "group/slim" : "group/card",
        "relative flex h-[var(--bb-sidebar-row-height,28px)] max-md:pointer-coarse:h-[var(--bb-sidebar-row-height-coarse,36px)] items-center gap-2 rounded-md px-2 text-xs transition-colors duration-150 ease-out motion-reduce:transition-none",
        isActive
          ? "bg-state-active bb-sidebar-selected-row text-sidebar-foreground"
          : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        !isActive && isSplitOpen && "bb-sidebar-open-in-split-row",
        isDragging && DRAG_LIFT_CLASS,
      )}
    >
      {beforeContent}
      {showProject && projectName ? <ProjectStripe projectId={thread.projectId} view="collapsed" /> : null}
      <ThreadDetailsTooltip thread={thread} disabled={isRenaming || isDragging} isOpen={isActive}>
        <a
          // Both attributes, or bb's nine thread shortcuts stop finding rows.
          data-sidebar-thread-shortcut-target=""
          data-sidebar-thread-id={thread.id}
          // bb routes a plain click in place and a Cmd/Ctrl-click to a split.
          href={thread.href}
          aria-label={label}
          aria-current={isActive ? "page" : undefined}
          {...linkProps}
          onClick={(event) => {
            if (isRenaming || event.detail > 1) {
              event.preventDefault();
              return;
            }
            onOpen();
          }}
          onDoubleClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onRenamingChange(true);
          }}
          className={linkProps?.className ?? "absolute inset-0 cursor-pointer rounded-md"}
        />
      </ThreadDetailsTooltip>
      {leading ? (
        <span
          data-settle-fade={fadeContent ? "" : undefined}
          className="pointer-events-none relative flex shrink-0 items-center"
        >
          {leading}
        </span>
      ) : null}
      <span
        data-settle-fade={fadeContent ? "" : undefined}
        className={cn(
          "pointer-events-none relative flex min-w-0 flex-1 items-center gap-1",
          isRenaming && "pointer-events-auto",
          muted && (isActive ? "text-sidebar-foreground" : "text-muted-foreground/70"),
          muted && "group-hover/slim:text-sidebar-foreground",
        )}
      >
        {showProject && projectName && !isRenaming ? (
          <>
            <ProjectFavicon projectId={thread.projectId} src={projectIconUrl} name={projectName} className="size-3" />
            <span
              style={projectColor}
              className={
                projectIconOnly
                  ? "sr-only"
                  : cn(
                      "max-w-[35%] shrink truncate text-xs",
                      projectColor
                        ? "bb-sidebar-project-name"
                        : !muted || isActive
                          ? "text-muted-foreground/70"
                          : "text-muted-foreground/50 group-hover/slim:text-muted-foreground/70",
                    )
              }
            >
              {projectName}
            </span>
            {sectionName && !projectIconOnly ? (
              <SectionBadge name={sectionName} colorStyle={sectionColor} pill className="max-w-[28%]" />
            ) : null}
            {!projectIconOnly ? (
              <span
                aria-hidden="true"
                className={cn(
                  "shrink-0 text-sm leading-none",
                  !muted || isActive
                    ? "text-muted-foreground/60"
                    : "text-muted-foreground/45 group-hover/slim:text-muted-foreground/60",
                )}
              >
                ·
              </span>
            ) : null}
          </>
        ) : sectionName && !isRenaming ? (
          <>
            <SectionBadge name={sectionName} colorStyle={sectionColor} className="max-w-[35%] shrink" />
            <span
              aria-hidden="true"
              className={cn(
                "shrink-0 text-sm leading-none",
                !muted || isActive
                  ? "text-muted-foreground/60"
                  : "text-muted-foreground/45 group-hover/slim:text-muted-foreground/60",
              )}
            >
              ·
            </span>
          </>
        ) : null}
        <InlineThreadTitle
          thread={thread}
          editing={isRenaming}
          onEditingChange={onRenamingChange}
          className={
            muted
              ? cn(
                  "min-w-0 flex-1 truncate text-sm leading-5 max-md:pointer-coarse:text-base",
                  isActive
                    ? "text-sidebar-foreground"
                    : "text-sidebar-foreground/80 group-hover/slim:text-sidebar-foreground",
                )
              : cn(
                  "min-w-0 flex-1 truncate text-sm leading-5 text-sidebar-foreground max-md:pointer-coarse:text-base",
                  thread.isUnread && "font-medium",
                )
          }
        />
      </span>
      {trailing}
    </div>
  );
}
