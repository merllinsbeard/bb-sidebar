// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderSlot } from "./test-slot";
import { defaultProviders, inbox, listProps, loadInboxApp, thread, toastMocks } from "./test-inbox";
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
  it("renders colored section badges in place of Personal and alongside non-Personal projects", async () => {
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

  it("filters threads via the top section bar, toggles back to All, and clears stale persisted filters", async () => {
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
});
