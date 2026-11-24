import type { CSSProperties } from "react";
import { cn } from "./lib/utils";
import { ProjectFavicon } from "./ProjectFavicon";

/** Whether a section repeats the project's own name (case-insensitive). */
export function isDuplicateSectionName(
  projectName: string | null | undefined,
  sectionName: string | null | undefined,
): boolean {
  if (!projectName || !sectionName) return false;
  return projectName.trim().toLowerCase() === sectionName.trim().toLowerCase();
}

/** Compact 6px colored section dot for one-line rows where a text pill crowds the title. */
export function SectionDot({
  name,
  colorStyle,
  includeLabel = false,
}: {
  name: string;
  colorStyle?: CSSProperties;
  includeLabel?: boolean;
}) {
  return (
    <span data-section-dot="" style={colorStyle} title={name} className="inline-flex shrink-0 items-center">
      <span aria-hidden="true" className="bb-sidebar-section-dot size-1.5 shrink-0 rounded-full" />
      {includeLabel ? <span className="sr-only">{name}</span> : null}
    </span>
  );
}

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
        "inline-flex min-w-0 max-w-full items-center gap-1 text-xs leading-4 font-normal",
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

/** Card metadata identity: project favicon + name, section badge, or both. */
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
      <span className="inline-flex min-w-0 max-w-full shrink items-center gap-1.5">
        <SectionBadge name={sectionName} colorStyle={sectionColor} />
      </span>
    );
  }
  if (!projectName) return null;
  const showSectionPill = Boolean(sectionName) && !isDuplicateSectionName(projectName, sectionName);
  return (
    <span className="inline-flex min-w-0 max-w-full shrink items-center gap-1.5 text-xs leading-4 font-normal text-muted-foreground">
      <ProjectFavicon projectId={projectId} src={projectIconUrl} name={projectName} className="size-3" />
      <span style={projectColor} className={cn("min-w-0 truncate", projectColor && "bb-sidebar-project-name")}>
        {projectName}
      </span>
      {showSectionPill && sectionName ? (
        <SectionBadge name={sectionName} colorStyle={sectionColor} pill className="max-w-[50%]" />
      ) : null}
    </span>
  );
}
