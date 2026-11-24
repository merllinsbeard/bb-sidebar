import { useInboxActions, useInboxEnvironment } from "./InboxContext";
import { UNSORTED_SECTION_FILTER } from "./section-colors";
import { cn } from "./lib/utils";

const PILL_CLASS =
  "inline-flex h-6 max-md:pointer-coarse:h-8 shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-xs font-normal outline-none transition-colors hover:bg-state-hover hover:text-sidebar-foreground focus-visible:ring-1 focus-visible:ring-ring";

export function SectionFilterBar() {
  const { sections, sectionColorById, sectionFilter, activeSortMode } = useInboxEnvironment();
  const { setSectionFilter } = useInboxActions();
  if (sections.length === 0 || activeSortMode === "section") return null;

  const toggle = (target: string) => setSectionFilter((current) => (current === target ? null : target));

  return (
    <div role="group" aria-label="Filter by section" className="flex flex-wrap items-center gap-1 pt-1">
      <button
        type="button"
        aria-pressed={sectionFilter === null}
        onClick={() => setSectionFilter(null)}
        className={cn(
          PILL_CLASS,
          sectionFilter === null ? "bg-state-active text-sidebar-foreground" : "text-subtle-foreground",
        )}
      >
        All
      </button>
      {sections.map((section) => {
        const active = sectionFilter === section.id;
        const colorStyle = sectionColorById.get(section.id);
        return (
          <button
            key={section.id}
            type="button"
            aria-pressed={active}
            style={colorStyle}
            onClick={() => toggle(section.id)}
            className={cn(PILL_CLASS, active ? "bg-state-active text-sidebar-foreground" : "text-subtle-foreground")}
          >
            <span aria-hidden="true" className="bb-sidebar-section-dot size-1.5 shrink-0 rounded-full" />
            <span>{section.name}</span>
          </button>
        );
      })}
      <button
        type="button"
        aria-pressed={sectionFilter === UNSORTED_SECTION_FILTER}
        onClick={() => toggle(UNSORTED_SECTION_FILTER)}
        className={cn(
          PILL_CLASS,
          sectionFilter === UNSORTED_SECTION_FILTER
            ? "bg-state-active text-sidebar-foreground"
            : "text-subtle-foreground",
        )}
      >
        Unsorted
      </button>
    </div>
  );
}
