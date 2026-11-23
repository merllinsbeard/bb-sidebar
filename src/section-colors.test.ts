import { describe, expect, it } from "vitest";
import {
  matchesSectionFilter,
  sectionBadgeStyle,
  sectionColorsById,
  sectionStylesById,
  UNSORTED_SECTION_FILTER,
} from "./section-colors";

describe("section colors", () => {
  it("assigns deterministic unique colors regardless of input order", () => {
    const ids = ["sec_alpha", "sec_beta", "sec_gamma", "sec_delta"];
    const forward = sectionColorsById(ids);
    const reversed = sectionColorsById([...ids].reverse());
    expect(reversed).toEqual(forward);
    expect(new Set(forward.values()).size).toBe(ids.length);
    for (const id of ids) {
      expect(forward.get(id)).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("derives readable light and dark contrast variables for badges", () => {
    const style = sectionBadgeStyle("#6b8e23") as Record<string, string>;
    expect(style["--bb-sidebar-project"]).toBe("#6b8e23");
    expect(style["--bb-sidebar-project-text-light"]).toMatch(/^#[0-9a-f]{6}$/);
    expect(style["--bb-sidebar-project-text-dark"]).toMatch(/^#[0-9a-f]{6}$/);

    const styles = sectionStylesById([{ id: "sec_1" }, { id: "sec_2" }]);
    expect(styles.size).toBe(2);
    expect((styles.get("sec_1") as Record<string, string>)["--bb-sidebar-project"]).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("matches threads against all, specific section, and unsorted filters", () => {
    const tagged = { sectionId: "sec_1" };
    const other = { sectionId: "sec_2" };
    const unsorted = { sectionId: null };

    expect(matchesSectionFilter(tagged, null)).toBe(true);
    expect(matchesSectionFilter(unsorted, null)).toBe(true);

    expect(matchesSectionFilter(tagged, "sec_1")).toBe(true);
    expect(matchesSectionFilter(other, "sec_1")).toBe(false);
    expect(matchesSectionFilter(unsorted, "sec_1")).toBe(false);

    expect(matchesSectionFilter(unsorted, UNSORTED_SECTION_FILTER)).toBe(true);
    expect(matchesSectionFilter(tagged, UNSORTED_SECTION_FILTER)).toBe(false);
  });
});
