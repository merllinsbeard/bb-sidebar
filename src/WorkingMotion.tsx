import type { PluginSidebarThreadIndicator } from "@get-bb/plugin-sdk";
import { createContext, useContext, type AnimationEvent, type CSSProperties } from "react";
import { cn } from "./lib/utils";
import type { WorkingMotion } from "./sidebar-settings-values";
import "./working-motion.css";

/**
 * The working style the user chose (setting `workingMotion`). Outside the
 * inbox nothing chose one, so glyphs keep the plain pulse.
 */
export const WorkingMotionContext = createContext<WorkingMotion>("pulse");

export function useWorkingMotion(): WorkingMotion {
  return useContext(WorkingMotionContext);
}

const WORKING_INDICATORS: ReadonlySet<PluginSidebarThreadIndicator> = new Set([
  "runtime",
  "workflow",
  "background-agent",
  "plan-mode",
  "background-command",
]);

/** Indicators that mean something is running for the thread right now. */
export function isWorkingIndicator(indicator: PluginSidebarThreadIndicator): boolean {
  return WORKING_INDICATORS.has(indicator);
}

const WORKING_ANIMATION = "bb-sidebar-working-";

/**
 * Pin every working animation under the element to the start of the document
 * timeline, so every working row, however late it mounted, is at the same
 * point of its cycle and they all change in the same frames.
 */
export function syncWorkingMotion(event: AnimationEvent<HTMLElement>) {
  if (!event.animationName.startsWith(WORKING_ANIMATION)) return;
  for (const animation of event.currentTarget.getAnimations({ subtree: true })) {
    if ("animationName" in animation && String(animation.animationName).startsWith(WORKING_ANIMATION)) {
      animation.startTime = 0;
    }
  }
}

const step = (index: number) => ({ "--i": index }) as CSSProperties;

/**
 * The decoration drawn around a working row's leading icon. It sits outside
 * the icon's 16px box, takes the status tone from `currentColor`, and never
 * takes space or clicks.
 */
export function WorkingRing({ motion }: { motion: WorkingMotion }) {
  return (
    <span aria-hidden="true" data-working-motion={motion} className="bb-sidebar-wm">
      {motion === "square-trace" ? (
        <span className="bb-sidebar-wm-trace" />
      ) : motion === "satellite" ? (
        <>
          <span className="bb-sidebar-wm-satellite-track" />
          <span className="bb-sidebar-wm-satellite" />
        </>
      ) : motion === "dots-ring" ? (
        Array.from({ length: 8 }, (_, index) => (
          <span key={index} className="bb-sidebar-wm-ring-dot" style={step(index)} />
        ))
      ) : motion === "double-arc" ? (
        <>
          <span className="bb-sidebar-wm-arc" />
          <span className="bb-sidebar-wm-counter-arc" />
        </>
      ) : (
        <span className={`bb-sidebar-wm-${motion}`} />
      )}
    </span>
  );
}

/** Cell order for each status style: the n-th cell lights at step n. */
const STATUS_CELLS: Partial<Record<WorkingMotion, readonly (number | null)[]>> = {
  // Around the 3×3 edge clockwise; the centre (null) stays dim.
  matrix: [0, 1, 2, 7, null, 3, 6, 5, 4],
  // A 2×2 loop: top left, top right, bottom right, bottom left.
  snake: [0, 1, 3, 2],
  "matrix-random": [0, 1, 2, 3, 4, 5, 6, 7, 8],
  dots: [0, 1, 2],
};

/** A status-placement style, drawn in place of the working glyph on the right. */
export function WorkingStatusMotion({
  motion,
  label,
  className,
}: {
  motion: WorkingMotion;
  label: string | undefined;
  className: string;
}) {
  const cells = STATUS_CELLS[motion] ?? [];
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label}
      data-working-motion={motion}
      className={cn("inline-flex items-center justify-center", className)}
      onAnimationStart={syncWorkingMotion}
    >
      <span className={`bb-sidebar-wm-cells bb-sidebar-wm-${motion}`}>
        {cells.map((order, index) => (
          <span key={index} data-still={order === null ? "" : undefined} style={step(order ?? 0)} />
        ))}
      </span>
    </span>
  );
}
