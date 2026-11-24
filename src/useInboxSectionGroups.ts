import { useCallback, useMemo } from "react";
import type { PluginSidebarSection, PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { ReorderScope } from "./inbox-layout";
import { projectCollapseCodec } from "./lib/inbox-preference-codecs";
import { STORAGE_KEYS } from "./lib/storage-keys";
import { usePersistedPreference } from "./lib/use-persisted-preference";
import {
  sectionGroupSiblingIds,
  sectionGroupView,
  UNSORTED_SECTION_GROUP_ID,
  type SectionGroupView,
} from "./section-groups";

function toggleId(ids: Set<string>, id: string): Set<string> {
  const next = new Set(ids);
  if (!next.delete(id)) next.add(id);
  return next;
}

export function useInboxSectionGroups({
  inbox,
  sections,
  activeThreadId,
}: {
  inbox: readonly PluginSidebarThread[];
  sections: readonly PluginSidebarSection[];
  activeThreadId: string | null;
}) {
  const validIds = useMemo(
    () => new Set([...sections.map((section) => section.id), UNSORTED_SECTION_GROUP_ID]),
    [sections],
  );
  const collapseCodec = useMemo(
    () => ({
      ...projectCollapseCodec,
      prune: (ids: Set<string>) => new Set([...ids].filter((id) => sections.length === 0 || validIds.has(id))),
    }),
    [sections.length, validIds],
  );
  const [collapsedSections, setCollapsedSections] = usePersistedPreference(
    STORAGE_KEYS.sectionCollapse.key,
    collapseCodec,
  );
  const toggleSectionCollapse = useCallback((id: string) => setCollapsedSections((ids) => toggleId(ids, id)), []);
  const groups: SectionGroupView[] = useMemo(
    () => sectionGroupView(inbox, sections, collapsedSections, activeThreadId),
    [inbox, sections, collapsedSections, activeThreadId],
  );
  const reorderScope = useCallback(
    (key: string): ReorderScope => ({
      mode: "thread",
      ids: sectionGroupSiblingIds(groups, key),
    }),
    [groups],
  );
  return { groups, toggleSectionCollapse, reorderScope };
}
