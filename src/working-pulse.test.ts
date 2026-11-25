// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { createElement, type AnimationEvent } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { StatusGlyph } from "./StatusGlyph";
import { syncWorkingMotion, WorkingMotionContext } from "./WorkingMotion";
import type { WorkingMotion } from "./sidebar-settings-values";

afterEach(cleanup);

describe("working pulse", () => {
  it("pulses an HTML wrapper around the working glyph, never the SVG itself", () => {
    const { container } = render(createElement(StatusGlyph, { indicator: "runtime", label: "Working" }));
    const wrapper = container.querySelector(".bb-sidebar-working-pulse");
    expect(wrapper?.tagName).toBe("SPAN");
    expect(wrapper?.querySelector('svg[data-icon="Working"]')).not.toBeNull();
    expect(container.querySelector("svg.bb-sidebar-working-pulse")).toBeNull();
  });

  it("leaves the other glyphs without a pulse", () => {
    const { container } = render(createElement(StatusGlyph, { indicator: "workflow", label: "Workflow" }));
    expect(container.querySelector(".bb-sidebar-working-pulse")).toBeNull();
  });

  it("pins every working animation under the row to the start of the timeline so working rows change together", () => {
    const pulse = { animationName: "bb-sidebar-working-pulse", startTime: 1234 as number | null };
    // The ring styles animate descendants and pseudo-elements of the element
    // the event fires on; only a subtree read finds them.
    const ring = { animationName: "bb-sidebar-working-spin", startTime: 567 as number | null };
    const other = { animationName: "something-else", startTime: 99 as number | null };
    const target = {
      getAnimations: (options?: GetAnimationsOptions) => (options?.subtree ? [pulse, ring, other] : [pulse, other]),
    } as unknown as HTMLElement;
    syncWorkingMotion({
      animationName: "bb-sidebar-working-pulse",
      currentTarget: target,
    } as AnimationEvent<HTMLElement>);
    expect(pulse.startTime).toBe(0);
    expect(ring.startTime).toBe(0);
    expect(other.startTime).toBe(99);
  });

  it("ignores other animations starting on the wrapper", () => {
    const pulse = { animationName: "bb-sidebar-working-pulse", startTime: 1234 as number | null };
    const target = { getAnimations: () => [pulse] } as unknown as HTMLElement;
    syncWorkingMotion({ animationName: "fade-in", currentTarget: target } as AnimationEvent<HTMLElement>);
    expect(pulse.startTime).toBe(1234);
  });

  it("shows the still working glyph where a status style has no room", () => {
    const { container } = render(
      createElement(
        WorkingMotionContext.Provider,
        { value: "matrix" satisfies WorkingMotion },
        createElement(StatusGlyph, { indicator: "runtime", label: "Working", small: true }),
      ),
    );
    expect(container.querySelector('svg[data-icon="Working"]')).not.toBeNull();
    expect(container.querySelector("[data-working-motion]")).toBeNull();
  });

  it("names a status style for assistive tech when the glyph carries a label", () => {
    const { getByRole } = render(
      createElement(
        WorkingMotionContext.Provider,
        { value: "matrix" satisfies WorkingMotion },
        createElement(StatusGlyph, { indicator: "runtime", label: "Working" }),
      ),
    );
    expect(getByRole("img", { name: "Working" }).dataset.workingMotion).toBe("matrix");
  });
});
