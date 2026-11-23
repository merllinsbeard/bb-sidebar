import { useEffect, useMemo } from "react";
import type { PluginSidebarSection } from "@get-bb/plugin-sdk/app";
import type { useSidebarThreads } from "./bb-sdk";
import { sectionStylesById, UNSORTED_SECTION_FILTER, type SectionFilter } from "./section-colors";
import { usePersistedPreference } from "./lib/use-persisted-preference";
import { STORAGE_KEYS } from "./lib/storage-keys";
import { sectionFilterCodec } from "./lib/inbox-preference-codecs";

export function useSectionFilter({
  sections,
  status,
}: {
  sections: readonly PluginSidebarSection[];
  status: ReturnType<typeof useSidebarThreads>["status"];
}) {
  const [storedFilter, setSectionFilter] = usePersistedPreference(STORAGE_KEYS.sectionFilter.key, sectionFilterCodec);
  const sectionById = useMemo(() => new Map(sections.map((section) => [section.id, section])), [sections]);
  const sectionColorById = useMemo(() => sectionStylesById(sections), [sections]);

  const isStale =
    status === "ready" &&
    storedFilter !== null &&
    storedFilter !== UNSORTED_SECTION_FILTER &&
    !sectionById.has(storedFilter);

  useEffect(() => {
    if (isStale) setSectionFilter(null);
  }, [isStale, setSectionFilter]);

  const sectionFilter: SectionFilter = isStale ? null : storedFilter;

  return { sectionById, sectionColorById, sectionFilter, setSectionFilter };
}
