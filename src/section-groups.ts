import type { PluginSidebarThread } from "@get-bb/plugin-sdk";
import { hiddenGroupAlerts } from "./environment-groups";
import { visibleShelfThreads, type GroupAlert } from "./inbox-layout";

export const UNSORTED_SECTION_GROUP_ID = "__unsorted__";

interface SectionSummary {
  readonly id: string;
  readonly name: string;
}

export interface SectionGroupView {
  /** Section ID, or UNSORTED_SECTION_GROUP_ID for threads without a section. */
  id: string;
  /** Display name: section name, or "Threads" for unsorted rows. */
  name: string;
  /** True for the fallback "Threads" group, which renders no colored dot. */
  isUnsorted: boolean;
  expanded: boolean;
  threadCount: number;
  alerts: GroupAlert[];
  threads: PluginSidebarThread[];
}

/**
 * Groups active inbox threads by BB's native thread sections in section order,
 * followed by a "Threads" group for unsorted threads (sectionId == null or
 * unknown). Empty sections are omitted. Threads preserve inbox order within
 * each section.
 */
export function sectionGroupView(
  threads: readonly PluginSidebarThread[],
  sections: readonly SectionSummary[],
  collapsedSections: ReadonlySet<string>,
  activeThreadId: string | null,
): SectionGroupView[] {
  const knownIds = new Set(sections.map((section) => section.id));
  const buckets = new Map<string, PluginSidebarThread[]>();
  const unsorted: PluginSidebarThread[] = [];

  for (const thread of threads) {
    if (thread.sectionId && knownIds.has(thread.sectionId)) {
      const bucket = buckets.get(thread.sectionId);
      if (bucket) bucket.push(thread);
      else buckets.set(thread.sectionId, [thread]);
    } else {
      unsorted.push(thread);
    }
  }

  const groups: SectionGroupView[] = [];
  for (const section of sections) {
    const bucket = buckets.get(section.id);
    if (!bucket || bucket.length === 0) continue;
    const expanded = !collapsedSections.has(section.id);
    const shown = visibleShelfThreads(bucket, expanded, activeThreadId);
    groups.push({
      id: section.id,
      name: section.name,
      isUnsorted: false,
      expanded,
      threadCount: bucket.length,
      alerts: expanded ? [] : hiddenGroupAlerts(bucket, shown),
      threads: shown,
    });
  }

  if (unsorted.length > 0) {
    const expanded = !collapsedSections.has(UNSORTED_SECTION_GROUP_ID);
    const shown = visibleShelfThreads(unsorted, expanded, activeThreadId);
    groups.push({
      id: UNSORTED_SECTION_GROUP_ID,
      name: "Threads",
      isUnsorted: true,
      expanded,
      threadCount: unsorted.length,
      alerts: expanded ? [] : hiddenGroupAlerts(unsorted, shown),
      threads: shown,
    });
  }

  return groups;
}

/** Visible thread IDs belonging to the same section group as `threadId`. */
export function sectionGroupSiblingIds(groups: readonly SectionGroupView[], threadId: string): string[] {
  const group = groups.find((candidate) => candidate.threads.some((thread) => thread.id === threadId));
  return group ? group.threads.map((thread) => thread.id) : [];
}
