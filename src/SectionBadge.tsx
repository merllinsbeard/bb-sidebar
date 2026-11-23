import type { CSSProperties } from "react";
import { cn } from "./lib/utils";
import { ProjectFavicon } from "./ProjectFavicon";

/** Colored dot + high-contrast section name, inline or as a compact pill. */
export function SectionBadge({
  name,
  colorStyle,
  pill = false,
  className,
}: {
  name: string;
  colorStyle?: CSSProperties;
  pill?: boolean;
  className?: string;
}) {
  return (
    <span
      data-section-badge=""
      style={colorStyle}
      className={cn(
        "inline-flex min-w-0 max-w-full items-center gap-1 text-2xs font-medium",
        pill && "bb-sidebar-section-pill shrink-0 rounded-full px-1.5 py-px",
        className,
      )}
    >
      <span aria-hidden="true" className="bb-sidebar-section-dot size-1.5 shrink-0 rounded-full" />
      <span className={cn("min-w-0 truncate", colorStyle ? "bb-sidebar-project-name" : "text-muted-foreground")}>
        {name}
      </span>
    </span>
  );
}

/** Card top-left header: project identity, section badge, or both. */
export function CardProjectHeader({
  projectId,
  projectName,
  projectIconUrl,
  projectColor,
  isPersonal,
  sectionName,
  sectionColor,
}: {
  projectId: string;
  projectName: string | null;
  projectIconUrl: string;
  projectColor?: CSSProperties;
  isPersonal: boolean;
  sectionName: string | null;
  sectionColor?: CSSProperties;
}) {
  if (isPersonal && sectionName) {
    return (
      <span data-settle-fade="" className="flex min-w-0 flex-1 items-center gap-1.5">
        <SectionBadge name={sectionName} colorStyle={sectionColor} />
      </span>
    );
  }
  return (
    <span
      data-settle-fade=""
      className="flex min-w-0 flex-1 items-center gap-1.5 text-2xs font-medium text-muted-foreground"
    >
      {projectName ? (
        <ProjectFavicon projectId={projectId} src={projectIconUrl} name={projectName} className="size-3" />
      ) : null}
      <span style={projectColor} className={cn("min-w-0 truncate", projectColor && "bb-sidebar-project-name")}>
        {projectName ?? " "}
      </span>
      {sectionName ? <SectionBadge name={sectionName} colorStyle={sectionColor} pill className="max-w-[45%]" /> : null}
    </span>
  );
}
