// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderSlot } from "./test-slot";
import { cacheSidebarSettings } from "./sidebar-settings";
import { inbox, defaultSidebarSettings, thread, defaultProviders, listProps, render, loadInboxApp } from "./test-inbox";

vi.mock("sonner", async () => (await import("./test-inbox")).sonnerMock());

await loadInboxApp();

const childProviders = [
  ...defaultProviders,
  ...[
    ["acp-opencode", "opencode"],
    ["acp-cursor", "Cursor"],
  ].map(([id, displayName]) => ({
    ...defaultProviders[0]!,
    id: id!,
    pluginId: `provider-${id}`,
    displayName: displayName!,
  })),
];

describe("ThreadInbox", () => {
  it("shows a child count badge with provider dots only on parent cards", () => {
    // Colour circles give each child its own dot; provider icons would show Codex once.
    cacheSidebarSettings({}, { ...defaultSidebarSettings, inactiveThreadsEnabled: false, childIconStyle: "disc" });
    const minute = Math.floor(Date.now() / 60_000) * 60_000;
    render([
      thread({
        id: "parent",
        title: "Parent",
        host: { id: "host_1", name: "Dev MacBook" },
        environment: {
          id: "env_1",
          name: "Worktree",
          branchName: "main",
          workspaceDisplayKind: "managed-worktree",
          path: null,
          isWorktree: true,
          providerId: null,
        },
      }),
      thread({
        id: "child-1",
        title: "One",
        parentThreadId: "parent",
        updatedAt: minute - 60_000,
      }),
      thread({ id: "child-2", title: "Two", parentThreadId: "parent" }),
      thread({ id: "child-3", title: "Three", parentThreadId: "parent" }),
      thread({ id: "child-4", title: "Four", parentThreadId: "parent" }),
      thread({ id: "child-5", title: "Five", parentThreadId: "parent" }),
      thread({ id: "root", title: "No children", host: { id: "host_2", name: "merlinde" } }),
    ]);

    const badge = screen.getByRole("button", { name: "5 child threads" });
    expect(badge.getAttribute("aria-expanded")).toBe("false");
    expect(badge.querySelectorAll("[data-child-thread-dot]")).toHaveLength(3);
    expect(badge.querySelector('[data-icon="ChevronDown"]')).not.toBeNull();
    const parentCard = badge.closest("li");
    expect(parentCard).not.toBeNull();
    const machine = within(parentCard!).getByLabelText("Machine: Dev MacBook");
    const providerGlyph = within(parentCard!).getByRole("img", {
      name: "Codex",
    });
    // Provider glyph leads the row; machine cue and child badge sit on the metadata subline.
    expect(providerGlyph.compareDocumentPosition(machine) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(machine.compareDocumentPosition(badge) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole("button", { name: /No children.*child/i })).toBeNull();
    expect(screen.queryByText("One")).toBeNull();
  });

  it("rolls the most urgent child state up into the parent badge", () => {
    render([
      thread({ id: "parent", title: "Parent" }),
      thread({
        id: "working",
        title: "Working child",
        parentThreadId: "parent",
        indicator: "runtime",
      }),
      thread({
        id: "done",
        title: "Done child",
        parentThreadId: "parent",
        indicator: "unread-success",
      }),
      thread({
        id: "quiet",
        title: "Quiet child",
        parentThreadId: "parent",
      }),
      thread({
        id: "failed-grandchild",
        title: "Failed grandchild",
        parentThreadId: "quiet",
        indicator: "unread-error",
      }),
    ]);

    const badge = screen.getByRole("button", {
      name: "3 child threads, 1 failed, 1 done, 1 working",
    });
    expect(badge.getAttribute("data-child-status")).toBe("failed");
    expect(badge.className).toContain("bg-[color:var(--bb-sidebar-badge-failed-bg)]");
    expect(badge.querySelector('[data-icon="CircleX"]')).not.toBeNull();
  });

  it("marks a badge with only working children as working", () => {
    render([
      thread({ id: "parent", title: "Parent" }),
      thread({
        id: "working",
        title: "Working child",
        parentThreadId: "parent",
        indicator: "runtime",
      }),
    ]);

    const badge = screen.getByRole("button", {
      name: "1 child thread, 1 working",
    });
    expect(badge.getAttribute("data-child-status")).toBe("working");
    expect(badge.className).toContain("bg-[color:var(--bb-sidebar-badge-working-bg)]");
    expect(badge.querySelector('[data-icon="Working"]')).not.toBeNull();
    expect(screen.getByRole("list", { name: "Child threads" })).toBeDefined();
    expect(screen.getByText("Working child")).toBeDefined();
  });

  // The needs-you rollup lost its coverage when the expanded-rows test was
  // rewritten: a raised hand anywhere in the subtree outranks live work, and
  // the badge has to say so in its tone, its data attribute and its glyph.
  it("marks a badge whose most urgent child needs the user", () => {
    render([
      thread({ id: "parent", title: "Parent" }),
      thread({
        id: "working",
        title: "Working child",
        parentThreadId: "parent",
        indicator: "runtime",
      }),
      thread({
        id: "asking",
        title: "Asking child",
        parentThreadId: "parent",
        hasPendingInteraction: true,
        indicator: "waiting-for-input",
      }),
    ]);

    const badge = screen.getByRole("button", {
      name: "2 child threads, 1 need you, 1 working",
    });
    expect(badge.getAttribute("data-child-status")).toBe("needs-you");
    expect(badge.className).toContain("bg-[color:var(--bb-sidebar-badge-needs-you-bg)]");
    expect(badge.querySelector('[data-icon="CircleQuestion"]')).not.toBeNull();
    expect(badge.querySelector('[data-icon="Working"]')).toBeNull();
  });

  it("keeps every child with a status visible while collapsed, and folds read ones", () => {
    render([
      thread({ id: "parent", title: "Parent" }),
      thread({
        id: "failed",
        title: "Failed child",
        parentThreadId: "parent",
        indicator: "unread-error",
      }),
      thread({
        id: "waiting",
        title: "Waiting child",
        parentThreadId: "parent",
        hasPendingInteraction: true,
        indicator: "waiting-for-input",
      }),
      thread({
        id: "unread",
        title: "Unread child",
        parentThreadId: "parent",
        indicator: "unread-success",
      }),
      thread({
        id: "working",
        title: "Working child",
        parentThreadId: "parent",
        indicator: "runtime",
      }),
      thread({ id: "idle", title: "Idle child", parentThreadId: "parent" }),
      // An idle child stays as the path to a grandchild that has news.
      thread({ id: "carrier", title: "Carrier child", parentThreadId: "parent" }),
      thread({
        id: "failed-grandchild",
        title: "Failed grandchild",
        parentThreadId: "carrier",
        indicator: "unread-error",
      }),
    ]);

    // Nothing was expanded: the list below is the collapsed view.
    const childList = screen.getByRole("list", { name: "Child threads" });
    for (const title of ["Failed child", "Waiting child", "Unread child", "Working child", "Carrier child"]) {
      expect(within(childList).getByText(title)).toBeDefined();
    }
    expect(within(childList).queryByText("Idle child")).toBeNull();
    expect(
      within(screen.getByRole("list", { name: "Grandchildren of Carrier child" })).getByText("Failed grandchild"),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: /6 child threads/ }).getAttribute("aria-expanded")).toBe("false");
  });

  it("can hide children that need attention while their section is collapsed", async () => {
    renderSlot(inbox, listProps, {
      sidebarThreads: {
        status: "ready",
        threads: [
          thread({ id: "parent", title: "Parent" }),
          thread({
            id: "working",
            title: "Working child",
            parentThreadId: "parent",
            indicator: "runtime",
          }),
        ],
        projects: [{ id: "proj_1", name: "bb", isPersonal: false, href: "", settingsHref: "" }],
      },
      rpc: {
        getSidebarSettings: () => ({
          ...defaultSidebarSettings,
          showRunningChildrenWhenCollapsed: false,
        }),
        listLifecycle: () => ({ rows: [] }),
      },
    });

    await waitFor(() => expect(screen.queryByRole("list", { name: "Child threads" })).toBeNull());
  });

  it("orders child rows by the saved child sort", async () => {
    renderSlot(inbox, listProps, {
      sidebarThreads: {
        status: "ready",
        threads: [
          thread({ id: "parent", title: "Parent" }),
          thread({
            id: "old",
            title: "Old child",
            parentThreadId: "parent",
            createdAt: 10,
            indicator: "runtime",
          }),
          thread({
            id: "new",
            title: "New child",
            parentThreadId: "parent",
            createdAt: 20,
            indicator: "runtime",
          }),
        ],
        projects: [{ id: "proj_1", name: "bb", isPersonal: false, href: "", settingsHref: "" }],
      },
      providers: { status: "ready", providers: defaultProviders },
      rpc: {
        getSidebarSettings: () => ({
          ...defaultSidebarSettings,
          inactiveThreadsEnabled: false,
          childSortDirection: "descending",
        }),
        listLifecycle: () => ({ rows: [] }),
      },
    });

    await waitFor(() => {
      const rows = within(screen.getByRole("list", { name: "Child threads" })).getAllByText(/child$/);
      expect(rows.map((row) => row.textContent)).toEqual(["New child", "Old child"]);
    });
  });

  it("shows provider icons for child threads when chosen", async () => {
    renderSlot(inbox, listProps, {
      sidebarThreads: {
        status: "ready",
        threads: [
          thread({ id: "parent", title: "Parent" }),
          thread({
            id: "codex-child",
            title: "Codex child",
            parentThreadId: "parent",
            providerId: "codex",
            indicator: "runtime",
          }),
          thread({
            id: "claude-child",
            title: "Claude child",
            parentThreadId: "parent",
            providerId: "claude-code",
            indicator: "runtime",
          }),
        ],
        projects: [{ id: "proj_1", name: "bb", isPersonal: false, href: "", settingsHref: "" }],
      },
      providers: { status: "ready", providers: defaultProviders },
      rpc: {
        getSidebarSettings: () => ({
          ...defaultSidebarSettings,
          inactiveThreadsEnabled: false,
          childIconStyle: "provider",
        }),
        listLifecycle: () => ({ rows: [] }),
      },
    });

    await waitFor(() => {
      const childList = screen.getByRole("list", { name: "Child threads" });
      expect(within(childList).getByRole("img", { name: "Codex" })).toBeDefined();
      expect(within(childList).getByRole("img", { name: "Claude Code" })).toBeDefined();
    });
  });

  // Moved from the removed header chip's tests: the badge's provider dots.
  it("shows each provider once, at most three, on the badge", async () => {
    renderSlot(inbox, listProps, {
      sidebarThreads: {
        status: "ready",
        threads: [
          thread({ id: "parent", title: "Parent" }),
          ...["codex", "codex", "claude-code", "acp-opencode", "acp-cursor"].map((providerId, index) =>
            thread({
              id: `child-${index}`,
              title: `Child ${index}`,
              parentThreadId: "parent",
              providerId,
              createdAt: 101 + index,
            }),
          ),
        ],
        projects: [{ id: "proj_1", name: "bb", isPersonal: false, href: "", settingsHref: "" }],
      },
      providers: { status: "ready", providers: childProviders },
      rpc: {
        getSidebarSettings: () => ({
          ...defaultSidebarSettings,
          inactiveThreadsEnabled: false,
          childIconStyle: "provider",
          // The badge follows the child order; oldest first puts Codex first.
          childSortDirection: "ascending",
        }),
        listLifecycle: () => ({ rows: [] }),
      },
    });
    await waitFor(() => {
      const badge = screen.getByRole("button", { name: "5 child threads" });
      const dots = badge.querySelectorAll("[data-child-thread-dot]");
      expect([...dots].map((dot) => dot.querySelector("[role=img]")?.getAttribute("aria-label"))).toEqual([
        "Codex",
        "Claude Code",
        "opencode",
      ]);
    });
  });

  // Moved from the removed header chip's tests: settings changes reach child
  // rows that are already on screen.
  it("reorders open child rows when the saved child sort changes", async () => {
    let remoteSettings = { ...defaultSidebarSettings, inactiveThreadsEnabled: false, childSortDirection: "descending" };
    const rendered = renderSlot(inbox, listProps, {
      sidebarThreads: {
        status: "ready",
        threads: [
          thread({ id: "parent", title: "Parent" }),
          thread({ id: "old", title: "Old child", parentThreadId: "parent", createdAt: 101 }),
          thread({ id: "new", title: "New child", parentThreadId: "parent", createdAt: 102 }),
        ],
        projects: [{ id: "proj_1", name: "bb", isPersonal: false, href: "", settingsHref: "" }],
      },
      rpc: { getSidebarSettings: () => remoteSettings, listLifecycle: () => ({ rows: [] }) },
    });
    fireEvent.click(await screen.findByRole("button", { name: "2 child threads" }));
    const rowNames = () =>
      within(screen.getByRole("list", { name: "Child threads" }))
        .getAllByRole("link", { name: /^Open child thread:/ })
        .map((row) => row.getAttribute("aria-label"));
    await waitFor(() => expect(rowNames()).toEqual(["Open child thread: New child", "Open child thread: Old child"]));

    remoteSettings = { ...remoteSettings, childSortDirection: "ascending" };
    await rendered.experimental_invalidateRpc(["sidebar-settings"]);
    await waitFor(() => expect(rowNames()).toEqual(["Open child thread: Old child", "Open child thread: New child"]));
  });

  it("switches badge and child row icons when the icon setting changes", async () => {
    let childIconStyle = "disc";
    const rendered = renderSlot(inbox, listProps, {
      sidebarThreads: {
        status: "ready",
        threads: [
          thread({ id: "parent", title: "Parent" }),
          thread({ id: "child", title: "Child", parentThreadId: "parent", hasPendingInteraction: true }),
        ],
        projects: [],
      },
      providers: { status: "ready", providers: childProviders },
      rpc: {
        getSidebarSettings: () => ({ ...defaultSidebarSettings, inactiveThreadsEnabled: false, childIconStyle }),
        listLifecycle: () => ({ rows: [] }),
      },
    });
    const badge = await screen.findByRole("button", { name: /^1 child thread/ });
    const row = screen.getByRole("link", { name: /^Open child thread: Child/ });
    // Provider icons are the default until the saved colour circles load.
    await waitFor(() => expect(within(row).queryByRole("img", { name: "Codex" })).toBeNull());
    const disc = badge.querySelector<HTMLElement>("[data-child-thread-dot] span");
    // Moved from the removed parent chip's tests: a child's colour comes from
    // its id, so the badge and the child row draw the same disc.
    expect(disc?.style.backgroundColor).toBe("oklch(0.72 0.13 156)");
    expect(row.querySelector<HTMLElement>("span.rounded-full")?.style.backgroundColor).toBe(
      disc?.style.backgroundColor,
    );

    childIconStyle = "provider";
    await rendered.experimental_invalidateRpc(["sidebar-settings"]);
    expect(await within(row).findByRole("img", { name: "Codex" })).toBeDefined();
    expect(badge.querySelector("[data-child-thread-dot] [role=img]")?.getAttribute("aria-label")).toBe("Codex");
    expect(row.getAttribute("aria-label")).toContain("Needs you");

    childIconStyle = "disc";
    await rendered.experimental_invalidateRpc(["sidebar-settings"]);
    await waitFor(() => expect(within(row).queryByRole("img", { name: "Codex" })).toBeNull());
    expect(badge.querySelector("[data-child-thread-dot] [role=img]")).toBeNull();
    expect(badge.querySelector<HTMLElement>("[data-child-thread-dot] span")?.style.backgroundColor).toBe(
      disc?.style.backgroundColor,
    );
    expect(row.getAttribute("aria-label")).toContain("Needs you");
  });

  it("omits child dots on compact rows while preserving count, status glyph, tooltip, and expand toggle", async () => {
    const now = Date.now();
    renderSlot(inbox, listProps, {
      sidebarThreads: {
        status: "ready",
        threads: [
          thread({ id: "full-parent", title: "Full parent", updatedAt: now }),
          thread({
            id: "full-child",
            title: "Full child",
            parentThreadId: "full-parent",
            providerId: "claude-code",
            updatedAt: now,
          }),
          thread({ id: "working-parent", title: "Working parent", indicator: "runtime", updatedAt: now }),
          thread({
            id: "working-child-1",
            title: "Working child 1",
            parentThreadId: "working-parent",
            providerId: "codex",
            indicator: "runtime",
            updatedAt: now,
          }),
          thread({
            id: "working-child-2",
            title: "Working child 2",
            parentThreadId: "working-parent",
            providerId: "claude-code",
            updatedAt: now,
          }),
          thread({ id: "settled-parent", title: "Settled parent", updatedAt: now }),
          thread({
            id: "settled-child",
            title: "Settled child",
            parentThreadId: "settled-parent",
            providerId: "codex",
            updatedAt: now,
          }),
        ],
        projects: [{ id: "proj_1", name: "oracle-enterprise", isPersonal: false, href: "", settingsHref: "" }],
      },
      providers: { status: "ready", providers: childProviders },
      rpc: {
        getSidebarSettings: () => ({
          ...defaultSidebarSettings,
          inactiveThreadsEnabled: false,
          workingShelf: true,
          childIconStyle: "provider",
        }),
        listLifecycle: () => ({
          rows: [{ threadId: "settled-parent", settledAt: now, snoozedUntil: null, snoozedAt: null }],
        }),
      },
    });

    // Full card retains leading provider dots inside ChildThreadBadge.
    const fullRow = (await screen.findByRole("link", { name: "Full parent" })).closest("li")!;
    const fullBadge = within(fullRow).getByRole("button", { name: "1 child thread" });
    expect(fullBadge.querySelectorAll("[data-child-thread-dot]")).toHaveLength(1);

    // Compact Working row omits dots but keeps count, tooltip/aria-label, status glyph, and expand toggle.
    await waitFor(() => {
      const workingRow = screen.getByRole("link", { name: "Working parent" }).closest("li")!;
      expect(workingRow.querySelector("[data-compact-row]")).not.toBeNull();
    });
    const workingRow = screen.getByRole("link", { name: "Working parent" }).closest("li")!;
    const workingBadge = within(workingRow).getByRole("button", { name: "2 child threads, 1 working" });
    expect(workingBadge.querySelectorAll("[data-child-thread-dot]")).toHaveLength(0);
    expect(workingBadge.getAttribute("data-child-status")).toBe("working");
    expect(workingBadge.querySelector('[data-icon="Working"]')).not.toBeNull();
    expect(workingBadge.textContent).toBe("2");
    expect(workingBadge.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(workingBadge);
    expect(workingBadge.getAttribute("aria-expanded")).toBe("true");
    expect(await screen.findByText("Working child 1")).toBeDefined();
    expect(screen.getByText("Working child 2")).toBeDefined();

    // Compact SlimRow (Settled shelf) also omits child dots while keeping expand toggle.
    fireEvent.click(screen.getByRole("button", { name: "Settled (1)" }));
    const settledRow = (await screen.findByRole("link", { name: "oracle-enterprise · Settled parent" })).closest("li")!;
    const settledBadge = within(settledRow).getByRole("button", { name: "1 child thread" });
    expect(settledBadge.querySelectorAll("[data-child-thread-dot]")).toHaveLength(0);
    expect(settledBadge.textContent).toBe("1");
    fireEvent.click(settledBadge);
    expect(await screen.findByText("Settled child")).toBeDefined();
  });
});
