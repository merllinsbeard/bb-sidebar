import { describe, expect, it } from "vitest";
import { sidebarThread as thread } from "./test-fixtures";
import { sectionGroupSiblingIds, sectionGroupView, UNSORTED_SECTION_GROUP_ID } from "./section-groups";

const sections = [
  { id: "sec_homelab", name: "homelab" },
  { id: "sec_empty", name: "empty-section" },
  { id: "sec_oracle", name: "oracle-enterprise" },
];

describe("sectionGroupView", () => {
  it("groups threads in section order, skips empty sections, and appends Threads for unsorted rows", () => {
    const t1 = thread({ id: "t1", sectionId: "sec_oracle" });
    const t2 = thread({ id: "t2", sectionId: "sec_homelab" });
    const t3 = thread({ id: "t3", sectionId: null });
    const t4 = thread({ id: "t4", sectionId: "sec_homelab" });
    const t5 = thread({ id: "t5", sectionId: "sec_deleted" });

    const groups = sectionGroupView([t1, t2, t3, t4, t5], sections, new Set(), null);
    expect(
      groups.map((group) => ({
        id: group.id,
        name: group.name,
        isUnsorted: group.isUnsorted,
        threadCount: group.threadCount,
        ids: group.threads.map((item) => item.id),
      })),
    ).toEqual([
      { id: "sec_homelab", name: "homelab", isUnsorted: false, threadCount: 2, ids: ["t2", "t4"] },
      { id: "sec_oracle", name: "oracle-enterprise", isUnsorted: false, threadCount: 1, ids: ["t1"] },
      { id: UNSORTED_SECTION_GROUP_ID, name: "Threads", isUnsorted: true, threadCount: 2, ids: ["t3", "t5"] },
    ]);
  });

  it("hides idle rows when collapsed, retains the open thread, and summarizes hidden alerts", () => {
    const failed = thread({ id: "failed", sectionId: "sec_homelab", indicator: "unread-error" });
    const asks = thread({ id: "asks", sectionId: "sec_homelab", hasPendingInteraction: true });
    const done = thread({ id: "done", sectionId: "sec_homelab", indicator: "unread-success" });
    const working = thread({ id: "working", sectionId: "sec_homelab", indicator: "runtime" });

    const collapsed = sectionGroupView([failed, asks, done, working], sections, new Set(["sec_homelab"]), "asks");
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0]).toMatchObject({
      id: "sec_homelab",
      expanded: false,
      threadCount: 4,
      threads: [asks],
      alerts: [
        { kind: "failed", count: 1 },
        { kind: "done", count: 1 },
      ],
    });
  });

  it("returns sibling thread ids within the same section group", () => {
    const a = thread({ id: "a", sectionId: "sec_homelab" });
    const b = thread({ id: "b", sectionId: "sec_homelab" });
    const c = thread({ id: "c", sectionId: null });
    const groups = sectionGroupView([a, b, c], sections, new Set(), null);

    expect(sectionGroupSiblingIds(groups, "b")).toEqual(["a", "b"]);
    expect(sectionGroupSiblingIds(groups, "c")).toEqual(["c"]);
    expect(sectionGroupSiblingIds(groups, "missing")).toEqual([]);
  });
});
