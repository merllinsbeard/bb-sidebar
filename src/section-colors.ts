import { projectColorsById, projectColorStyle } from "./project-colors";

type SectionBadgeStyle = ReturnType<typeof projectColorStyle>;

export const UNSORTED_SECTION_FILTER = "__unsorted__";

export type SectionFilter = null | typeof UNSORTED_SECTION_FILTER | string;

/** Deterministic hex colors for BB's native thread sections. */
export function sectionColorsById(sectionIds: readonly string[]): ReadonlyMap<string, string> {
  return projectColorsById(sectionIds, {});
}

/** High-contrast light/dark CSS variables for a section dot and label. */
export function sectionBadgeStyle(color: string): SectionBadgeStyle {
  return projectColorStyle(color);
}

/** Deterministic CSS variable maps keyed by section id. */
export function sectionStylesById(sections: readonly { id: string }[]): ReadonlyMap<string, SectionBadgeStyle> {
  const colors = sectionColorsById(sections.map((section) => section.id));
  const styles = new Map<string, SectionBadgeStyle>();
  for (const [id, color] of colors) {
    styles.set(id, sectionBadgeStyle(color));
  }
  return styles;
}

/** Whether a thread belongs in the active section filter view. */
export function matchesSectionFilter(thread: { readonly sectionId?: string | null }, filter: SectionFilter): boolean {
  if (filter === null) return true;
  if (filter === UNSORTED_SECTION_FILTER) return thread.sectionId == null;
  return thread.sectionId === filter;
}
