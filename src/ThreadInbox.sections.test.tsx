// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderSlot } from "./test-slot";
import {
  defaultProviders,
  defaultSidebarSettings,
  inbox,
  listProps,
  loadInboxApp,
  thread,
  toastMocks,
} from "./test-inbox";
import { STORAGE_KEYS } from "./lib/storage-keys";

vi.mock("sonner", async () => (await import("./test-inbox")).sonnerMock());

await loadInboxApp();

const sections = [
  { id: "sec_ops", name: "Ops", createdAt: 1, updatedAt: 1 },
  { id: "sec_sales", name: "Sales", createdAt: 2, updatedAt: 2 },
];

const projects = [
  { id: "proj_personal", name: "Personal", isPersonal: true, href: "", settingsHref: "" },
  { id: "proj_work", name: "Acme", isPersonal: false, href: "", settingsHref: "" },
];

describe("thread sections", () => {
  it("defaults to native collapsible section groups when sections exist and hides redundant section badges", async () => {
    const first = renderSlot(
      inbox,
      { ...listProps, activeThreadId: "t_ops_open" },
      {
        sidebarThreads: {
          status: "ready",
          threads: [
            thread({ id: "t_ops_open", projectId: "proj_personal", sectionId: "sec_ops", title: "Open ops task" }),
            thread({
              id: "t_ops_unread",
              projectId: "proj_personal",
              sectionId: "sec_ops",
              title: "Unread ops task",
              indicator: "unread-success",
              isUnread: true,
            }),
            thread({ id: "t_sales", projectId: "proj_work", sectionId: "sec_sales", title: "Deal review" }),
            thread({ id: "t_loose", projectId: "proj_personal", sectionId: null, title: "Loose personal" }),
          ],
          projects,
          sections,
        },
        providers: { status: "ready", providers: defaultProviders },
        rpc: { listLifecycle: () => ({ rows: [] }) },
      },
    );

    const active = await screen.findByRole("region", { name: "Active" });
    expect(within(active).getByRole("button", { name: "Sort active threads: Sections" })).toBeDefined();
    // Section filter bar stays hidden in Sections mode so no chips clip at the top.
    expect(screen.queryByRole("group", { name: "Filter by section" })).toBeNull();

    // Named sections appear in order, followed by the unsorted Threads group.
    const opsGroup = within(active).getByRole("region", { name: "Ops section" });
    const salesGroup = within(active).getByRole("region", { name: "Sales section" });
    const unsortedGroup = within(active).getByRole("region", { name: "Threads section" });
    expect(opsGroup.querySelector(".bb-sidebar-section-dot")).not.toBeNull();
    expect(salesGroup.querySelector(".bb-sidebar-section-dot")).not.toBeNull();
    expect(unsortedGroup.querySelector(".bb-sidebar-section-dot")).toBeNull();

    // Rows inside a section group omit the redundant section badge, so Personal rows collapse to 1 line.
    const opsCard = within(opsGroup).getByRole("link", { name: "Open ops task" }).closest("[data-parent-card]")!;
    expect(opsCard.getAttribute("data-row-metadata")).toBe("false");
    expect(opsCard.querySelector("[data-section-badge]")).toBeNull();

    const salesCard = within(salesGroup).getByRole("link", { name: "Deal review" }).closest("li")!;
    expect(within(salesCard).getByText("Acme")).toBeDefined();
    expect(salesCard.querySelector("[data-section-badge]")).toBeNull();

    // Collapsing a section hides non-active rows, shows hidden alert dots, and persists across remount.
    fireEvent.click(within(opsGroup).getByRole("button", { name: "Ops (2)", expanded: true }));
    expect(within(opsGroup).getByRole("link", { name: "Open ops task" })).toBeDefined();
    expect(within(opsGroup).queryByRole("link", { name: "Unread ops task" })).toBeNull();
    expect(within(opsGroup).getByRole("button", { name: "Ops (2), 1 done", expanded: false })).toBeDefined();
    await waitFor(() =>
      expect(JSON.parse(window.localStorage.getItem(STORAGE_KEYS.sectionCollapse.key) ?? "[]")).toEqual(["sec_ops"]),
    );

    first.unmount();
    renderSlot(inbox, listProps, {
      sidebarThreads: {
        status: "ready",
        threads: [
          thread({ id: "t_ops_unread", projectId: "proj_personal", sectionId: "sec_ops", title: "Unread ops task" }),
          thread({ id: "t_loose", projectId: "proj_personal", sectionId: null, title: "Loose personal" }),
        ],
        projects,
        sections,
      },
      providers: { status: "ready", providers: defaultProviders },
      rpc: { listLifecycle: () => ({ rows: [] }) },
    });

    const remountedOps = await screen.findByRole("region", { name: "Ops section" });
    expect(within(remountedOps).getByRole("button", { name: "Ops (1)", expanded: false })).toBeDefined();
    expect(within(remountedOps).queryByText("Unread ops task")).toBeNull();

    // Switching to Manual order reveals the wrapped filter bar; switching back ignores stale filter pills.
    fireEvent.keyDown(screen.getByRole("button", { name: "Sort active threads: Sections" }), { key: "Enter" });
    fireEvent.click(screen.getByRole("radio", { name: "Manual order" }), { detail: 1 });
    const bar = await screen.findByRole("group", { name: "Filter by section" });
    expect(bar.className).toContain("flex-wrap");
    fireEvent.click(within(bar).getByRole("button", { name: "Ops" }));
    expect(screen.queryByText("Loose personal")).toBeNull();

    fireEvent.keyDown(screen.getByRole("button", { name: "Sort active threads: Manual order" }), { key: "Enter" });
    fireEvent.click(screen.getByRole("radio", { name: "Sections" }), { detail: 1 });
    expect(screen.queryByRole("group", { name: "Filter by section" })).toBeNull();
    expect(screen.getByRole("region", { name: "Threads section" })).toBeDefined();
  });

  it("renders colored section badges in place of Personal and alongside non-Personal projects in manual mode", async () => {
    window.localStorage.setItem(STORAGE_KEYS.activeSort.key, "manual");
    const now = Date.now();
    renderSlot(inbox, listProps, {
      sidebarThreads: {
        status: "ready",
        threads: [
          thread({ id: "t_personal_sec", projectId: "proj_personal", sectionId: "sec_ops", title: "Ops task" }),
          thread({ id: "t_personal_none", projectId: "proj_personal", sectionId: null, title: "Loose personal" }),
          thread({ id: "t_work_sec", projectId: "proj_work", sectionId: "sec_sales", title: "Deal review" }),
          thread({ id: "t_parked_sec", projectId: "proj_personal", sectionId: "sec_ops", title: "Parked ops" }),
        ],
        projects,
        sections,
      },
      providers: { status: "ready", providers: defaultProviders },
      rpc: {
        listLifecycle: () => ({
          rows: [{ threadId: "t_parked_sec", parkedAt: now, settledAt: null, snoozedUntil: null, snoozedAt: null }],
        }),
      },
    });

    const opsRow = (await screen.findByRole("link", { name: "Ops task" })).closest("li")!;
    expect(within(opsRow).getByText("Ops")).toBeDefined();
    expect(within(opsRow).queryByText("Personal")).toBeNull();

    const looseRow = screen.getByRole("link", { name: "Loose personal" }).closest("li")!;
    expect(within(looseRow).queryByText("Personal")).toBeNull();
    expect(looseRow.querySelector("[data-section-badge]")).toBeNull();

    const workRow = screen.getByRole("link", { name: "Deal review" }).closest("li")!;
    expect(within(workRow).getByText("Acme")).toBeDefined();
    expect(within(workRow).getByText("Sales")).toBeDefined();

    fireEvent.click(await screen.findByRole("button", { name: /Parked/ }));
    const parkedRow = (await screen.findByRole("link", { name: "Ops · Parked ops" })).closest("li")!;
    expect(within(parkedRow).getByText("Ops")).toBeDefined();
    expect(within(parkedRow).queryByText("Personal")).toBeNull();
  });

  it("filters threads via the wrapped section bar in manual mode, toggles back to All, and clears stale persisted filters", async () => {
    window.localStorage.setItem(STORAGE_KEYS.activeSort.key, "manual");
    window.localStorage.setItem(STORAGE_KEYS.sectionFilter.key, "sec_deleted");
    renderSlot(inbox, listProps, {
      sidebarThreads: {
        status: "ready",
        threads: [
          thread({ id: "t_ops", projectId: "proj_work", sectionId: "sec_ops", title: "Ops thread" }),
          thread({ id: "t_sales", projectId: "proj_work", sectionId: "sec_sales", title: "Sales thread" }),
          thread({ id: "t_none", projectId: "proj_personal", sectionId: null, title: "Unsorted thread" }),
        ],
        projects,
        sections,
      },
      providers: { status: "ready", providers: defaultProviders },
      rpc: { listLifecycle: () => ({ rows: [] }) },
    });

    const bar = await screen.findByRole("group", { name: "Filter by section" });
    // Chips wrap cleanly instead of clipping section names mid-word.
    expect(bar.className).toContain("flex-wrap");
    expect(bar.className).not.toContain("overflow-x-auto");
    // Stale persisted section id falls back to All once ready.
    expect(within(bar).getByRole("button", { name: "All" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Ops thread")).toBeDefined();
    expect(screen.getByText("Sales thread")).toBeDefined();
    expect(screen.getByText("Unsorted thread")).toBeDefined();

    fireEvent.click(within(bar).getByRole("button", { name: "Ops" }));
    expect(screen.getByText("Ops thread")).toBeDefined();
    expect(screen.queryByText("Sales thread")).toBeNull();
    expect(screen.queryByText("Unsorted thread")).toBeNull();

    // Clicking the active pill toggles back to All.
    fireEvent.click(within(bar).getByRole("button", { name: "Ops" }));
    expect(screen.getByText("Sales thread")).toBeDefined();
    expect(screen.getByText("Unsorted thread")).toBeDefined();

    // Unsorted keeps only threads with sectionId == null.
    fireEvent.click(within(bar).getByRole("button", { name: "Unsorted" }));
    expect(screen.getByText("Unsorted thread")).toBeDefined();
    expect(screen.queryByText("Ops thread")).toBeNull();
    expect(screen.queryByText("Sales thread")).toBeNull();
  });

  it("assigns and clears sections from the row context menu and reports failures", async () => {
    let shouldFail = false;
    const updates: Array<{ threadId: string; sectionId?: string | null }> = [];
    renderSlot(inbox, listProps, {
      sidebarThreads: {
        status: "ready",
        threads: [thread({ id: "t_1", projectId: "proj_work", sectionId: "sec_ops", title: "Target thread" })],
        projects,
        sections,
      },
      providers: { status: "ready", providers: defaultProviders },
      rpc: { listLifecycle: () => ({ rows: [] }) },
      sdk: {
        threads: {
          update: async (args) => {
            if (shouldFail) throw new Error("server offline");
            updates.push({ threadId: args.threadId, sectionId: args.sectionId });
            return { id: args.threadId } as never;
          },
        },
      },
    });

    fireEvent.contextMenu(await screen.findByText("Target thread"));
    const menu = await screen.findByRole("menu", { name: "Thread actions" });
    fireEvent.click(within(menu).getByText("Section"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Sales" }));
    await waitFor(() => expect(updates).toEqual([{ threadId: "t_1", sectionId: "sec_sales" }]));

    fireEvent.contextMenu(screen.getByText("Target thread"));
    fireEvent.click(within(await screen.findByRole("menu", { name: "Thread actions" })).getByText("Section"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "No section" }));
    await waitFor(() =>
      expect(updates).toEqual([
        { threadId: "t_1", sectionId: "sec_sales" },
        { threadId: "t_1", sectionId: null },
      ]),
    );

    shouldFail = true;
    fireEvent.contextMenu(screen.getByText("Target thread"));
    fireEvent.click(within(await screen.findByRole("menu", { name: "Thread actions" })).getByText("Section"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Ops" }));
    await waitFor(() =>
      expect(toastMocks.error).toHaveBeenCalledWith("Could not update section", {
        className: "bb-sidebar-toast",
        description: "server offline",
      }),
    );
  });

  it("does not promote unsectioned children of sectioned parents when filtering by Unsorted", async () => {
    window.localStorage.setItem(STORAGE_KEYS.activeSort.key, "manual");
    renderSlot(inbox, listProps, {
      sidebarThreads: {
        status: "ready",
        threads: [
          thread({ id: "t_parent", projectId: "proj_work", sectionId: "sec_ops", title: "Sectioned parent" }),
          thread({
            id: "t_child",
            projectId: "proj_work",
            parentThreadId: "t_parent",
            sectionId: null,
            title: "Subagent child",
          }),
          thread({ id: "t_unsorted", projectId: "proj_personal", sectionId: null, title: "Top-level unsorted" }),
        ],
        projects,
        sections,
      },
      providers: { status: "ready", providers: defaultProviders },
      rpc: { listLifecycle: () => ({ rows: [] }) },
    });

    const bar = await screen.findByRole("group", { name: "Filter by section" });
    fireEvent.click(within(bar).getByRole("button", { name: "Unsorted" }));
    expect(screen.getByText("Top-level unsorted")).toBeDefined();
    expect(screen.queryByText("Sectioned parent")).toBeNull();
    expect(screen.queryByText("Subagent child")).toBeNull();
  });

  it("deduplicates matching project and section names and keeps compact working rows readable with a dot", async () => {
    window.localStorage.setItem(STORAGE_KEYS.activeSort.key, "manual");
    const sameSections = [
      { id: "sec_oracle", name: "oracle-enterprise", createdAt: 1, updatedAt: 1 },
      { id: "sec_homelab", name: "homelab", createdAt: 2, updatedAt: 2 },
    ];
    const sameProjects = [
      { id: "proj_personal", name: "Personal", isPersonal: true, href: "", settingsHref: "" },
      { id: "proj_oracle", name: "oracle-enterprise", isPersonal: false, href: "", settingsHref: "" },
    ];
    renderSlot(inbox, listProps, {
      sidebarThreads: {
        status: "ready",
        threads: [
          thread({
            id: "t_full_same",
            projectId: "proj_oracle",
            sectionId: "sec_oracle",
            title: "Full duplicate identity",
          }),
          thread({
            id: "t_work_same",
            projectId: "proj_oracle",
            sectionId: "sec_oracle",
            title: "Working duplicate identity",
            indicator: "runtime",
          }),
          thread({
            id: "t_work_personal",
            projectId: "proj_personal",
            sectionId: "sec_homelab",
            title: "Working personal section",
            indicator: "runtime",
          }),
        ],
        projects: sameProjects,
        sections: sameSections,
      },
      providers: { status: "ready", providers: defaultProviders },
      rpc: {
        getSidebarSettings: () => ({
          ...defaultSidebarSettings,
          inactiveThreadsEnabled: false,
          workingShelf: true,
        }),
        listLifecycle: () => ({ rows: [] }),
      },
    });

    const fullRow = (await screen.findByRole("link", { name: "Full duplicate identity" })).closest("li")!;
    expect(within(fullRow).getAllByText("oracle-enterprise")).toHaveLength(1);
    expect(fullRow.querySelector("[data-section-badge]")).toBeNull();

    const workingSameRow = (await screen.findByRole("link", { name: "Working duplicate identity" })).closest("li")!;
    expect(within(workingSameRow).getAllByText("oracle-enterprise")).toHaveLength(1);
    expect(workingSameRow.querySelector("[data-section-badge]")).toBeNull();
    expect(workingSameRow.querySelector("[data-section-dot]")).toBeNull();

    const workingPersonalRow = screen.getByRole("link", { name: "Working personal section" }).closest("li")!;
    expect(workingPersonalRow.querySelector("[data-section-badge]")).toBeNull();
    expect(workingPersonalRow.querySelector("[data-section-dot]")?.getAttribute("title")).toBe("homelab");
    expect(within(workingPersonalRow).getByText("homelab").classList.contains("sr-only")).toBe(true);
    expect(within(workingPersonalRow).queryByText("·")).toBeNull();
  });

  it("ignores legacy active-sort:v1 manual preference so live browsers pick up Sections default and persist to v2", async () => {
    window.localStorage.setItem("bb-sidebar:active-sort:v1", "manual");
    window.localStorage.setItem(STORAGE_KEYS.activeGrouping.key, "true");
    renderSlot(inbox, listProps, {
      sidebarThreads: {
        status: "ready",
        threads: [thread({ id: "t_ops", projectId: "proj_personal", sectionId: "sec_ops", title: "Ops task" })],
        projects,
        sections,
      },
      providers: { status: "ready", providers: defaultProviders },
      rpc: { listLifecycle: () => ({ rows: [] }) },
    });

    const active = await screen.findByRole("region", { name: "Active" });
    expect(within(active).getByRole("button", { name: "Sort active threads: Sections" })).toBeDefined();
    expect(within(active).getByRole("region", { name: "Ops section" })).toBeDefined();
    expect(window.localStorage.getItem(STORAGE_KEYS.activeSort.key)).toBeNull();

    fireEvent.keyDown(within(active).getByRole("button", { name: "Sort active threads: Sections" }), { key: "Enter" });
    fireEvent.click(screen.getByRole("radio", { name: "Manual order" }), { detail: 1 });
    await waitFor(() => expect(window.localStorage.getItem(STORAGE_KEYS.activeSort.key)).toBe("manual"));
    expect(STORAGE_KEYS.activeSort.key).toBe("bb-sidebar:active-sort:v2");
  });
});
