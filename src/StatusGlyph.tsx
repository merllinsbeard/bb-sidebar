import type { PluginSidebarThreadIndicator } from "@get-bb/plugin-sdk";
import { Icon } from "./components/Icon";
import { unhandledIndicator } from "./child-status";
import { StillThreadStatusGlyph } from "./StillThreadStatusGlyph";
import { cn } from "./lib/utils";
import { WORKING_MOTION_STYLES } from "./sidebar-settings-values";
import { syncWorkingMotion, useWorkingMotion, WorkingStatusMotion } from "./WorkingMotion";
import "./working-pulse.css";

/** Status palette shared by cards, child labels, and glyphs. */
export function statusToneClass(indicator: PluginSidebarThreadIndicator): string {
  switch (indicator) {
    case "unread-error":
      return "text-[color:var(--bb-sidebar-tone-error)]";
    case "waiting-for-input":
      return "text-[color:var(--bb-sidebar-tone-pending)]";
    case "unread-success":
      return "text-[color:var(--bb-sidebar-tone-success)]";
    case "runtime":
    case "workflow":
    case "background-agent":
    case "plan-mode":
      return "text-[color:var(--bb-sidebar-tone-working)]";
    case "background-command":
      // Only a process the agent started is running, not the agent itself.
      return "text-[color:var(--bb-sidebar-tone-command)]";
    case "draft":
    case "working-draft":
    case "queued-waiting":
      return "text-[color:var(--bb-sidebar-tone-draft)]";
    case "queued-failed":
      return "text-[color:var(--bb-sidebar-tone-error)]";
    case "none":
      return "text-subtle-foreground";
    default:
      unhandledIndicator(indicator);
      return "text-subtle-foreground";
  }
}

/**
 * This plugin's status glyphs, matching bb's own sidebar shape for shape: the
 * red circle-x for a failure, the circle-question for a raised hand, and a dot
 * for a finished thread you have not read.
 *
 * The SDK ships `indicator` as data and no status component on purpose, so a
 * replaced sidebar can choose its own look. This one deliberately does not:
 * the two lists sit in the same window, and a user who switches between them
 * should not have to learn a second vocabulary.
 *
 * Live work is where this list departs from bb, on purpose. bb spins a
 * spinner and shines the activity glyphs forever. In Chromium any running
 * animation redraws the window at the display's refresh rate, and on a 120 Hz
 * Mac that kept bb's renderer, GPU process and WindowServer near a full core
 * for as long as a thread worked, however small the glyph. A slower spin or a
 * stepped one still cost a third of that, and a spinner held still reads as
 * frozen. So live work gets a pulse in a box, which says "running" without
 * promising motion, in the enclosed style of the circle-x and the
 * circle-question; the bare pulse stays the Active shelf's. It breathes the way
 * T3 Code's status dot does, mostly holding still (see working-pulse.css),
 * which costs a few points of a core instead of a full one. The activity
 * glyphs keep their shapes and hold still. The working tone and
 * "Working · 5m" carry the rest, and a spinner never said whether an agent was
 * alive anyway. See get-bb/bb#7233.
 *
 * That pulse is now one choice of the "Working animation" setting
 * (`workingMotion`, WorkingMotion.tsx). The default draws around the row's
 * provider icon instead; rows with that ring drop this glyph (StatusOrTime),
 * and the rest hold it still. The setting's description names the cost of
 * the smooth styles.
 *
 * An indicator this sidebar has no shape for, such as a kind bb ships after
 * this build, is drawn with bb's own glyph, held still: bb adds kinds over
 * time, and users must not lose a status bb would show them.
 */

export function StatusGlyph({
  indicator,
  label,
  className,
  small = false,
}: {
  indicator: PluginSidebarThreadIndicator;
  label: string | null;
  className?: string;
  /**
   * A glyph smaller than the row's 14px, such as the hover card's 10px
   * badge: a status style has no room there, so the working glyph holds
   * still instead.
   */
  small?: boolean;
}) {
  const shared = cn("size-3.5 shrink-0", className);
  const aria = label ?? undefined;

  switch (indicator) {
    case "unread-error":
      return <Icon name="CircleX" aria-label={aria} className={cn(shared, statusToneClass(indicator))} />;
    case "waiting-for-input":
      return <Icon name="CircleQuestion" aria-label={aria} className={cn(shared, statusToneClass(indicator))} />;
    case "runtime":
      return <RuntimeGlyph label={aria} className={cn(shared, statusToneClass(indicator))} small={small} />;
    case "workflow":
      return <ActivityIcon name="Workflow" label={aria} className={cn(shared, statusToneClass(indicator))} />;
    case "background-agent":
      return <ActivityIcon name="UserRoundPlus" label={aria} className={cn(shared, statusToneClass(indicator))} />;
    case "background-command":
      return <ActivityIcon name="Terminal" label={aria} className={cn(shared, statusToneClass(indicator))} />;
    case "plan-mode":
      return <ActivityIcon name="ListTodo" label={aria} className={cn(shared, statusToneClass(indicator))} />;
    case "draft":
    case "working-draft":
      return <Icon name="Edit" aria-label={aria} className={cn(shared, statusToneClass(indicator))} />;
    case "unread-success":
      // The notification dot, in a box the size of every other glyph, the way
      // bb centers its own trailing indicators. Right-aligned on its own, a
      // 5px dot would sit ~4px off the column the icons share.
      return (
        <span aria-label={aria} className={cn("flex items-center justify-center", shared, statusToneClass(indicator))}>
          <span className="size-[5px] rounded-full bg-current" />
        </span>
      );
    case "queued-failed":
    case "queued-waiting":
      // bb's own glyphs: the sidebar has no shape of its own for a queued send.
      return <HostIndicatorGlyph indicator={indicator} label={aria} className={shared} />;
    case "none":
      return null;
    default:
      return <HostIndicatorGlyph indicator={unhandledIndicator(indicator)} label={aria} className={shared} />;
  }
}

/**
 * The working glyph in the user's working style: the pulse, a status style in
 * its place, or held still while the row's icon carries the motion.
 */
function RuntimeGlyph({ label, className, small }: { label: string | undefined; className: string; small: boolean }) {
  const motion = useWorkingMotion();
  const { placement } = WORKING_MOTION_STYLES[motion];
  const glyph = <Icon name="Working" aria-label={label} className={className} />;
  if (placement === "status") {
    return small ? glyph : <WorkingStatusMotion motion={motion} label={label} className={className} />;
  }
  if (placement === "icon") return glyph;
  return (
    <span className="bb-sidebar-working-pulse inline-flex shrink-0" onAnimationStart={syncWorkingMotion}>
      {glyph}
    </span>
  );
}

/**
 * bb's glyph for an indicator this sidebar does not draw itself, held still
 * like every other glyph here and sized to the same box.
 */
function HostIndicatorGlyph({
  indicator,
  label,
  className,
}: {
  indicator: PluginSidebarThreadIndicator;
  label: string | undefined;
  className: string;
}) {
  return (
    <span
      aria-label={label}
      role={label ? "img" : undefined}
      className={cn("inline-flex items-center justify-center [&_svg]:size-full", className)}
    >
      <StillThreadStatusGlyph indicator={indicator} size="compact" />
    </span>
  );
}

function ActivityIcon({
  name,
  label,
  className,
}: {
  name: "Workflow" | "UserRoundPlus" | "Terminal" | "ListTodo";
  label: string | undefined;
  className: string;
}) {
  return <Icon name={name} aria-label={label} className={cn("opacity-75", className)} />;
}
