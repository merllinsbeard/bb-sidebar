import type { CSSProperties } from "react";
import { useEnvironmentPullRequest } from "./bb-sdk";
import { ChildThreadBadge } from "./ChildThreadList";
import { Tooltip } from "./components/Tooltip";
import { cn } from "./lib/utils";
import { OpenPortsIndicator } from "./OpenPorts";
import { pullRequestStatusLabel, pullRequestToneClass } from "./pull-request-display";
import { CardProjectHeader } from "./SectionBadge";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { Icon } from "./components/Icon";

interface RowMetadataModel {
  showProjectIdentity: boolean;
  showSection: boolean;
  showBranch: boolean;
  showHost: boolean;
  showMachineIcon: boolean;
  hasChildren: boolean;
  hasWorkflows: boolean;
  hasBackgroundAgents: boolean;
  hasOpenPorts: boolean;
  showOpenPortsInline: boolean;
  hasPullRequest: boolean;
  hasAny: boolean;
}

/**
 * Resolves which compact metadata items earn a second line under a thread title.
 * When `hasAny` is false the card collapses to a single native-height row and
 * any open-ports icon moves inline onto the title row.
 */
export function describeRowMetadata({
  thread,
  showProject,
  isPersonalProject,
  projectName,
  hasSection,
  showEnvironment,
  hasMultipleHosts,
  childCount,
  hasOpenPorts,
  hasPullRequest,
}: {
  thread: PluginSidebarThread;
  showProject: boolean;
  isPersonalProject: boolean;
  projectName: string | null;
  hasSection: boolean;
  showEnvironment: boolean;
  hasMultipleHosts: boolean;
  childCount: number;
  hasOpenPorts: boolean;
  hasPullRequest: boolean;
}): RowMetadataModel {
  const showProjectIdentity = showProject && !isPersonalProject && Boolean(projectName);
  const showSection = hasSection;
  const showBranch = showEnvironment && Boolean(thread.environment?.branchName);
  const showHost = showEnvironment && !showBranch && hasMultipleHosts && Boolean(thread.host);
  const showMachineIcon = showBranch && hasMultipleHosts && Boolean(thread.host);
  const hasChildren = childCount > 0;
  const hasWorkflows = thread.activity.workflows > 0;
  const hasBackgroundAgents = thread.activity.backgroundAgents > 0;
  const hasAny =
    showProjectIdentity ||
    showSection ||
    showBranch ||
    showHost ||
    hasChildren ||
    hasWorkflows ||
    hasBackgroundAgents ||
    hasPullRequest;
  const showOpenPortsInline = hasOpenPorts && !hasAny;
  return {
    showProjectIdentity,
    showSection,
    showBranch,
    showHost,
    showMachineIcon,
    hasChildren,
    hasWorkflows,
    hasBackgroundAgents,
    hasOpenPorts,
    showOpenPortsInline,
    hasPullRequest,
    hasAny,
  };
}

function ThreadLocation({ thread, showHost = true }: { thread: PluginSidebarThread; showHost?: boolean }) {
  const branchName = thread.environment?.branchName;
  if (branchName) {
    const isWorktree = thread.environment?.isWorktree === true;
    return (
      <span className="flex min-w-0 shrink items-center gap-1 truncate">
        <Icon
          name={isWorktree ? "FolderGit" : "GitBranch"}
          aria-label={isWorktree ? "Worktree branch" : "Branch"}
          className="size-3 shrink-0 text-muted-foreground/60"
        />
        <span className="truncate font-mono">{branchName}</span>
      </span>
    );
  }
  if (showHost && thread.host) {
    return (
      <span className="flex min-w-0 shrink items-center gap-1 truncate">
        <Icon name="Computer" aria-hidden className="size-3 shrink-0 text-muted-foreground/60" />
        <span className="truncate">{thread.host.name}</span>
      </span>
    );
  }
  return null;
}

function ThreadPullRequest({ environmentId }: { environmentId: string | null }) {
  const pullRequest = useEnvironmentPullRequest(environmentId);
  if (!pullRequest) return null;
  return (
    <Tooltip label={`${pullRequest.title}\n${pullRequestStatusLabel(pullRequest)}`} className="whitespace-pre-line">
      <a
        href={pullRequest.url}
        target="_blank"
        rel="noreferrer"
        onClick={(event) => event.stopPropagation()}
        className={cn(
          "pointer-events-auto relative shrink-0 font-mono hover:underline",
          pullRequestToneClass(pullRequest),
        )}
      >
        #{pullRequest.number}
      </a>
    </Tooltip>
  );
}

/** Optional compact `pl-6` metadata subline aligned beneath a thread's title. */
export function ThreadMetadataSubline({
  thread,
  metadata,
  projectName,
  projectIconUrl,
  projectColor,
  sectionName,
  sectionColor,
  hasMultipleHosts,
  childThreads,
  childrenByParent,
  childrenExpanded,
  childListId,
  onToggleChildren,
}: {
  thread: PluginSidebarThread;
  metadata: RowMetadataModel;
  projectName: string | null;
  projectIconUrl: string;
  projectColor?: CSSProperties;
  sectionName: string | null;
  sectionColor?: CSSProperties;
  hasMultipleHosts: boolean;
  childThreads: readonly PluginSidebarThread[];
  childrenByParent: ReadonlyMap<string, readonly PluginSidebarThread[]>;
  childrenExpanded: boolean;
  childListId: string;
  onToggleChildren: () => void;
}) {
  if (!metadata.hasAny) return null;
  return (
    <div
      data-settle-fade=""
      data-row-metadata-line=""
      className="pointer-events-none relative mt-0.5 flex min-h-4 min-w-0 items-center gap-1.5 pl-6 text-xs leading-4 text-muted-foreground"
    >
      {metadata.showProjectIdentity || metadata.showSection ? (
        <CardProjectHeader
          projectId={thread.projectId}
          projectName={metadata.showProjectIdentity ? projectName : null}
          projectIconUrl={projectIconUrl}
          projectColor={projectColor}
          isPersonal={!metadata.showProjectIdentity}
          sectionName={sectionName}
          sectionColor={sectionColor}
        />
      ) : null}
      {metadata.showBranch || metadata.showHost ? <ThreadLocation thread={thread} showHost={hasMultipleHosts} /> : null}
      {metadata.showMachineIcon && thread.host ? (
        <Icon
          name="Computer"
          aria-label={`Machine: ${thread.host.name}`}
          className="size-3 shrink-0 text-muted-foreground/60"
        />
      ) : null}
      <OpenPortsIndicator thread={thread} />
      {metadata.hasChildren ? (
        <ChildThreadBadge
          threads={childThreads}
          childrenByParent={childrenByParent}
          expanded={childrenExpanded}
          controls={childListId}
          onToggle={onToggleChildren}
        />
      ) : null}
      {metadata.hasWorkflows ? <ActivityCount label="workflows" count={thread.activity.workflows} /> : null}
      {metadata.hasBackgroundAgents ? (
        <ActivityCount label="background agents" count={thread.activity.backgroundAgents} />
      ) : null}
      {metadata.hasPullRequest ? <ThreadPullRequest environmentId={thread.environment?.id ?? null} /> : null}
    </div>
  );
}

function ActivityCount({ label, count }: { label: string; count: number }) {
  return (
    <span
      aria-label={`${count} ${label}`}
      className="shrink-0 rounded bg-muted px-1 font-mono text-xs leading-4 text-muted-foreground"
    >
      {count}
    </span>
  );
}
