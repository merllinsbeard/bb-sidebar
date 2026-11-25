// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { renderSlot } from "./test-slot";
import { decodeSettingsCache } from "./lib/settings-cache-codec";
import type { WorkingMotion } from "./sidebar-settings-values";
import { inbox, defaultSidebarSettings, thread, listProps, loadInboxApp } from "./test-inbox";

vi.mock("sonner", async () => (await import("./test-inbox")).sonnerMock());

await loadInboxApp();

const PROJECT = { id: "proj_1", name: "bb", isPersonal: false, href: "", settingsHref: "" };

function renderInbox(
  settings: Partial<typeof defaultSidebarSettings> & { workingMotion?: WorkingMotion },
  threads = [
    thread({ id: "busy", title: "Busy thread", indicator: "runtime", indicatorLabel: "Working" }),
    thread({ id: "idle", title: "Idle thread" }),
  ],
) {
  return renderSlot(inbox, listProps, {
    sidebarThreads: { status: "ready", threads, projects: [PROJECT] },
    rpc: {
      listLifecycle: () => ({ rows: [] }),
      getSidebarSettings: () => ({ ...defaultSidebarSettings, inactiveThreadsEnabled: false, ...settings }),
    },
  });
}

/** The row a thread link belongs to: a parent card or a child row. */
function rowOf(title: string): HTMLElement {
  const link = screen.getByRole("link", { name: new RegExp(title) });
  return (link.closest("[data-parent-card]") ?? link.closest("li")) as HTMLElement;
}

const ring = (row: HTMLElement) => row.querySelector<HTMLElement>(".bb-sidebar-wm[data-working-motion]");

describe("working motion", () => {
  it.each(["full", "compact-all"] as const)(
    "traces a square around the provider icon of a working row by default (%s)",
    async (threadDisplay) => {
      renderInbox({ threadDisplay });
      await screen.findByText("Busy thread");
      const busy = rowOf("Busy thread");
      await waitFor(() => expect(ring(busy)?.dataset.workingMotion).toBe("square-trace"));
      // The ring belongs to the provider icon's box, not to the status slot.
      expect(ring(busy)?.parentElement?.querySelector('[role="img"]')).not.toBeNull();
      expect(ring(busy)?.getAttribute("aria-hidden")).toBe("true");
      // The ring is the row's one working mark: no working glyph on the right.
      expect(busy.querySelector('[data-icon="Working"]')).toBeNull();
      expect(busy.querySelector(".bb-sidebar-working-pulse")).toBeNull();
      expect(within(busy).getByText("Working")).toBeDefined();
      // The first minute reads "<1m", so the right side is never blank.
      expect(within(busy).getByText("<1m")).toBeDefined();
      expect(ring(rowOf("Idle thread"))).toBeNull();
    },
  );

  it.each([
    ["runtime", "working"],
    ["workflow", "working"],
    ["background-agent", "working"],
    ["plan-mode", "working"],
    ["background-command", "command"],
  ] as const)("rings the icon of a row with %s, in the %s tone", async (indicator, tone) => {
    renderInbox({}, [thread({ id: "busy", title: "Busy thread", indicator })]);
    await screen.findByText("Busy thread");
    const mark = await waitFor(() => {
      const found = ring(rowOf("Busy thread"))?.parentElement;
      expect(found).toBeDefined();
      return found as HTMLElement;
    });
    expect(mark.className).toContain(`--bb-sidebar-tone-${tone})`);
  });

  it("keeps the glyph that names the work beside the ring", async () => {
    renderInbox({}, [thread({ id: "busy", title: "Busy thread", indicator: "background-command" })]);
    await screen.findByText("Busy thread");
    const busy = rowOf("Busy thread");
    await waitFor(() => expect(ring(busy)).not.toBeNull());
    expect(busy.querySelector('[data-icon="Terminal"]')).not.toBeNull();
  });

  it("drops the working glyph of a ringed child row", async () => {
    renderInbox({}, [
      thread({ id: "parent", title: "Parent thread" }),
      thread({ id: "child", title: "Child thread", parentThreadId: "parent", indicator: "runtime" }),
    ]);
    const children = await screen.findByRole("list", { name: "Child threads" });
    const child = within(children)
      .getByRole("link", { name: /Child thread/ })
      .closest("li") as HTMLElement;
    expect(ring(child)).not.toBeNull();
    expect(child.querySelector('[data-icon="Working"]')).toBeNull();
  });

  it("shows no working ring on a row that needs the user", async () => {
    renderInbox({}, [thread({ id: "busy", title: "Busy thread", indicator: "runtime", hasPendingInteraction: true })]);
    await screen.findByText("Busy thread");
    await waitFor(() => expect(within(rowOf("Busy thread")).getByText("Needs you")).toBeDefined());
    expect(ring(rowOf("Busy thread"))).toBeNull();
  });

  it("draws the ring around a working child row's icon", async () => {
    renderInbox({}, [
      thread({ id: "parent", title: "Parent thread" }),
      thread({ id: "child", title: "Child thread", parentThreadId: "parent", indicator: "runtime" }),
    ]);
    const children = await screen.findByRole("list", { name: "Child threads" });
    const child = within(children)
      .getByRole("link", { name: /Child thread/ })
      .closest("li") as HTMLElement;
    expect(ring(child)?.dataset.workingMotion).toBe("square-trace");
  });

  it("restores today's boxed pulse with no ring when the user picks Pulse", async () => {
    renderInbox({ workingMotion: "pulse" });
    await screen.findByText("Busy thread");
    const busy = rowOf("Busy thread");
    await waitFor(() => expect(busy.querySelector(".bb-sidebar-working-pulse [data-icon='Working']")).not.toBeNull());
    expect(document.querySelector("[data-working-motion]")).toBeNull();
    // The provider icon sits straight in its slot, as before the setting existed.
    expect(busy.querySelector('[data-settle-fade] > [role="img"]')).not.toBeNull();
  });

  it("replaces the working glyph on the right with a status style", async () => {
    renderInbox({ workingMotion: "matrix" });
    await screen.findByText("Busy thread");
    const busy = rowOf("Busy thread");
    await waitFor(() => expect(busy.querySelector('[data-working-motion="matrix"]')).not.toBeNull());
    expect(busy.querySelector('[data-icon="Working"]')).toBeNull();
    expect(ring(busy)).toBeNull();
    expect(within(busy).getByText("Working")).toBeDefined();
  });

  it("falls back to the square trace for a cached style this build does not know", () => {
    const cached = decodeSettingsCache({ ...defaultSidebarSettings, workingMotion: "sparkle" });
    expect(cached?.workingMotion).toBe("square-trace");
  });
});
