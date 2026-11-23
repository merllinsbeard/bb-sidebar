import { useInboxActions, useInboxEnvironment } from "./InboxContext";
import { UNSORTED_SECTION_FILTER } from "./section-colors";
import { cn } from "./lib/utils";

const PILL_CLASS =
  "inline-flex min-h-6 max-w-full shrink-0 cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-2xs font-medium outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-1 focus-visible:ring-ring";

export function SectionFilterBar() {
  const { sections, sectionColorById, sectionFilter } = useInboxEnvironment();
  const { setSectionFilter } = useInboxActions();
  if (sections.length === 0) return null;

  const toggle = (target: string) => setSectionFilter((current) => (current === target ? null : target));

  return (
    <div role="group" aria-label="Filter by section" className="flex flex-wrap gap-1 pt-1">
      <button
        type="button"
        aria-pressed={sectionFilter === null}
        onClick={() => setSectionFilter(null)}
        className={cn(
          PILL_CLASS,
          sectionFilter === null ? "bg-sidebar-accent text-foreground" : "text-muted-foreground",
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
            className={cn(
              PILL_CLASS,
              "min-w-0",
              active ? "bg-sidebar-accent text-foreground" : "text-muted-foreground",
            )}
          >
            <span aria-hidden="true" className="bb-sidebar-section-dot size-1.5 shrink-0 rounded-full" />
            <span className="truncate">{section.name}</span>
          </button>
        );
      })}
      <button
        type="button"
        aria-pressed={sectionFilter === UNSORTED_SECTION_FILTER}
        onClick={() => toggle(UNSORTED_SECTION_FILTER)}
        className={cn(
          PILL_CLASS,
          sectionFilter === UNSORTED_SECTION_FILTER ? "bg-sidebar-accent text-foreground" : "text-muted-foreground",
        )}
      >
        Unsorted
      </button>
    </div>
  );
}
