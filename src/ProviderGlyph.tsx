import type { PluginSidebarThreadIndicator } from "@get-bb/plugin-sdk";
import type { ReactNode } from "react";
import { ProviderIcon, type useProviders } from "./bb-sdk";
import { cn } from "./lib/utils";
import { WORKING_MOTION_STYLES } from "./sidebar-settings-values";
import { statusToneClass } from "./StatusGlyph";
import { isWorkingIndicator, syncWorkingMotion, useWorkingMotion, WorkingRing } from "./WorkingMotion";

export type SidebarProvider = ReturnType<typeof useProviders>["providers"][number];

/**
 * The agent a thread runs on, resolved from bb's live provider directory.
 *
 * Leads a thread row (matching bb's native sidebar) or compact/child rows.
 * bb draws a known provider's artwork, with its theme tint. A provider
 * missing from the current directory gets a neutral dot.
 *
 * Given the row's `indicator`, it also carries the row's working motion.
 */
export function ProviderGlyph({
  providerId,
  provider,
  indicator,
  className,
}: {
  providerId: string;
  provider: SidebarProvider | null;
  /** The row's indicator; leave it out where the glyph is not a row's lead. */
  indicator?: PluginSidebarThreadIndicator;
  className?: string;
}) {
  const label = provider?.displayName ?? providerId;
  const glyph = (
    <span
      role="img"
      aria-label={label}
      className={cn(
        "flex size-4 shrink-0 items-center justify-center overflow-hidden rounded-[4px] [&_img]:!size-full [&_img]:!max-w-full [&_img]:!max-h-full [&_img]:object-cover [&_svg]:max-h-full [&_svg]:max-w-full",
        className,
      )}
    >
      {provider ? (
        <ProviderIcon providerKind="agent" provider={provider} aria-hidden className="size-3.5 text-muted-foreground" />
      ) : (
        <span className="size-2 rounded-full bg-muted-foreground/50" />
      )}
    </span>
  );
  return indicator === undefined ? glyph : <WorkingMark indicator={indicator}>{glyph}</WorkingMark>;
}

/**
 * A row's leading mark. When the user's working style draws around the icon,
 * the mark sits in a 16px box that, while the row works, carries that ring in
 * the status tone, outside the box so neither the icon nor the row moves. The
 * box stays on idle rows too, so a row does not remount when work starts.
 * Other styles leave the mark as it was.
 */
export function WorkingMark({ indicator, children }: { indicator: PluginSidebarThreadIndicator; children: ReactNode }) {
  const motion = useWorkingMotion();
  if (WORKING_MOTION_STYLES[motion].placement !== "icon") return <>{children}</>;
  const ring = isWorkingIndicator(indicator);
  return (
    <span
      className={cn(
        "relative inline-flex size-4 shrink-0 items-center justify-center",
        ring && statusToneClass(indicator),
      )}
      onAnimationStart={ring ? syncWorkingMotion : undefined}
    >
      {children}
      {ring ? <WorkingRing motion={motion} /> : null}
    </span>
  );
}
