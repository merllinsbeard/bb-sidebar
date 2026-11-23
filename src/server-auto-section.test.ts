import { describe, expect, it, vi } from "vitest";
import { makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import plugin from "./server";
import { matchSectionDeterministic, parseClassifiedSection } from "./server-auto-section";
import { createFakePluginHost, disposers, projectThread, projectsWith, standardProject } from "./test-server";

const SECTIONS = [
  { id: "sec_sidebar", name: "Sidebar", createdAt: 1, updatedAt: 1 },
  { id: "sec_ops", name: "Ops & Infra", createdAt: 2, updatedAt: 2 },
  { id: "sec_sales", name: "Sales", createdAt: 3, updatedAt: 3 },
];

describe("auto-section pure helpers", () => {
  it("matches non-personal project names and workspace slugs deterministically", () => {
    expect(matchSectionDeterministic("sidebar", false, null, SECTIONS)?.id).toBe("sec_sidebar");
    expect(matchSectionDeterministic("Other", false, "/home/merlin/Dev/projects/ops-infra", SECTIONS)?.id).toBe(
      "sec_ops",
    );
    // Personal projects never match deterministically by project name or path.
    expect(matchSectionDeterministic("Sidebar", true, "/workspace/sidebar", SECTIONS)).toBeNull();
    expect(matchSectionDeterministic("Unrelated", false, "/workspace/unrelated", SECTIONS)).toBeNull();
  });

  it("parses model output strictly against live section names", () => {
    expect(parseClassifiedSection("Sales", SECTIONS)?.id).toBe("sec_sales");
    expect(parseClassifiedSection("  **ops & infra**  ", SECTIONS)?.id).toBe("sec_ops");
    expect(parseClassifiedSection("```\n`Sales`\n```", SECTIONS)?.id).toBe("sec_sales");
    expect(parseClassifiedSection("Section: Sidebar", SECTIONS)?.id).toBe("sec_sidebar");
    expect(parseClassifiedSection("NONE", SECTIONS)).toBeNull();
    expect(parseClassifiedSection("none", SECTIONS)).toBeNull();
    expect(parseClassifiedSection("Invented Section", SECTIONS)).toBeNull();
    expect(parseClassifiedSection("", SECTIONS)).toBeNull();
    expect(parseClassifiedSection(null, SECTIONS)).toBeNull();
  });
});

describe("server auto-section classifier & CLI", () => {
  function setupHost(options?: {
    threads?: ReturnType<typeof projectThread>[];
    projects?: ReturnType<typeof projectsWith>;
    sections?: typeof SECTIONS;
    modelOutput?: string | null;
    waitThrows?: boolean;
  }) {
    const threads = options?.threads ?? [
      projectThread({ id: "thr_1", projectId: "proj_personal", title: "Review Q4 sales deck" }),
    ];
    const projects = options?.projects ?? [
      {
        ...standardProject(),
        id: "proj_personal",
        name: "Personal",
        kind: "personal" as const,
        defaultExecutionOptions: null,
        threads,
      },
    ];
    const sections = options?.sections ?? SECTIONS;
    const updated: Array<{ threadId: string; sectionId: string | null }> = [];
    const deleted: string[] = [];
    const spawned: unknown[] = [];

    const { bb, harness } = createFakePluginHost({
      pluginId: "bb-sidebar",
      sdk: {
        projects: { list: async () => projects as never },
        threadSections: { list: async () => sections as never },
        threads: {
          get: async ({ threadId }) => {
            const match = threads.find((t) => t.id === threadId);
            if (!match) throw new Error(`Unknown thread ${threadId}`);
            return makeThreadResponse(match);
          },
          events: {
            list: async ({ threadId }) => [
              {
                id: "ev_1",
                seq: 1,
                threadId,
                createdAt: 1,
                scope: { kind: "thread" as const },
                type: "item/completed" as const,
                data: {
                  item: {
                    id: "item_1",
                    type: "userMessage" as const,
                    content: [{ type: "text" as const, text: "Prepare sales proposal for enterprise lead" }],
                  },
                },
              } as never,
            ],
          },
          spawn: async (args) => {
            spawned.push(args);
            return makeThreadResponse({ id: "thr_helper_1", visibility: "hidden" });
          },
          wait: async ({ threadId }) => {
            if (options?.waitThrows) throw new Error("timeout");
            return {
              matched: true as const,
              target: { kind: "status" as const, status: "idle" as const },
              thread: makeThreadResponse({ id: threadId, status: "idle" }),
              threadId,
            };
          },
          output: async () => ({ output: options?.modelOutput ?? "Sales" }),
          delete: async ({ threadId }) => {
            deleted.push(threadId);
            return { ok: true as const };
          },
          update: async ({ threadId, sectionId }) => {
            updated.push({ threadId, sectionId: sectionId ?? null });
            const match = threads.find((t) => t.id === threadId);
            if (match) match.sectionId = sectionId ?? null;
            return makeThreadResponse({ id: threadId, sectionId: sectionId ?? null });
          },
        },
      },
    });

    return { bb, harness, threads, updated, deleted, spawned };
  }

  it("classifies deterministically with zero AI spawns and supports --dry-run", async () => {
    const t = projectThread({ id: "thr_det", projectId: "proj_1", title: "Fix sidebar bug" });
    const { bb, harness, updated, spawned } = setupHost({
      threads: [t],
      projects: projectsWith([t]),
    });
    await plugin(bb);
    disposers.push(() => harness.lifecycle.dispose());

    const dry = await harness.behavior.runCli(["classify", "--thread", "thr_det", "--dry-run", "--json"]);
    expect(dry.exitCode).toBe(0);
    expect(JSON.parse(dry.stdout)).toMatchObject({
      assigned: 1,
      results: [
        { threadId: "thr_det", status: "matched_dry_run", method: "deterministic", section: { name: "Sidebar" } },
      ],
    });
    expect(updated).toEqual([]);
    expect(spawned).toEqual([]);

    const real = await harness.behavior.runCli(["classify", "--thread", "thr_det", "--json"]);
    expect(real.exitCode).toBe(0);
    expect(JSON.parse(real.stdout)).toMatchObject({
      assigned: 1,
      results: [{ threadId: "thr_det", status: "assigned", method: "deterministic", section: { id: "sec_sidebar" } }],
    });
    expect(updated).toEqual([{ threadId: "thr_det", sectionId: "sec_sidebar" }]);
    expect(spawned).toEqual([]);
  });

  it("falls back to a hidden helper thread and always deletes it even on timeout", async () => {
    const { bb, harness, updated, deleted, spawned } = setupHost({ modelOutput: "Sales" });
    await plugin(bb);
    disposers.push(() => harness.lifecycle.dispose());

    const result = await harness.behavior.runCli(["classify", "--thread", "thr_1", "--json"]);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      assigned: 1,
      results: [{ threadId: "thr_1", status: "assigned", method: "model", section: { id: "sec_sales" } }],
    });
    expect(spawned).toEqual([
      expect.objectContaining({
        visibility: "hidden",
        providerId: "antigravity",
        model: "gemini-4-hydrogen",
        reasoningLevel: "low",
      }),
    ]);
    expect(deleted).toEqual(["thr_helper_1"]);
    expect(updated).toEqual([{ threadId: "thr_1", sectionId: "sec_sales" }]);

    // Even when waiting fails, the hidden helper thread is still deleted.
    const failing = setupHost({ waitThrows: true });
    await plugin(failing.bb);
    disposers.push(() => failing.harness.lifecycle.dispose());
    const failed = await failing.harness.behavior.runCli(["classify", "--thread", "thr_1"]);
    expect(failed.exitCode).toBe(1);
    expect(failing.deleted).toEqual(["thr_helper_1"]);
  });

  it("skips hidden, child, and already-sectioned threads unless --force is passed", async () => {
    const threads = [
      projectThread({ id: "thr_hidden", projectId: "proj_personal", visibility: "hidden" }),
      projectThread({ id: "thr_child", projectId: "proj_personal", parentThreadId: "thr_root" }),
      projectThread({ id: "thr_done", projectId: "proj_personal", sectionId: "sec_ops", title: "Already done" }),
    ];
    const { bb, harness, updated, spawned } = setupHost({ threads, modelOutput: "Sales" });
    await plugin(bb);
    disposers.push(() => harness.lifecycle.dispose());

    for (const [id, reason] of [
      ["thr_hidden", "not_visible"],
      ["thr_child", "child_thread"],
      ["thr_done", "already_sectioned"],
    ] as const) {
      const res = await harness.behavior.runCli(["classify", "--thread", id, "--json"]);
      expect(JSON.parse(res.stdout)).toMatchObject({
        skipped: 1,
        results: [{ threadId: id, status: "skipped", reason }],
      });
    }
    expect(spawned).toEqual([]);
    expect(updated).toEqual([]);

    const forced = await harness.behavior.runCli(["classify", "--thread", "thr_done", "--force", "--json"]);
    expect(JSON.parse(forced.stdout)).toMatchObject({
      assigned: 1,
      results: [{ threadId: "thr_done", status: "assigned", section: { id: "sec_sales" } }],
    });
  });

  it("auto-classifies once on thread.idle, records attempt idempotently, and respects autoClassifySections toggle", async () => {
    vi.useFakeTimers();
    try {
      const t1 = projectThread({ id: "thr_auto", projectId: "proj_personal", title: "Enterprise sales" });
      const t2 = projectThread({ id: "thr_off", projectId: "proj_personal", title: "Ignored when off" });
      const { bb, harness, updated, spawned } = setupHost({ threads: [t1, t2], modelOutput: "Sales" });
      await plugin(bb);
      disposers.push(() => harness.lifecycle.dispose());

      await harness.behavior.emitThreadEvent("thread.idle", {
        thread: makeThreadResponse(t1),
        lastAssistantText: null,
      });
      await vi.advanceTimersByTimeAsync(4_000);
      expect(updated).toEqual([{ threadId: "thr_auto", sectionId: "sec_sales" }]);
      expect(spawned).toHaveLength(1);

      // Even if sectionId is cleared externally, the recorded attempt prevents redundant auto-spawns.
      t1.sectionId = null;
      await harness.behavior.emitThreadEvent("thread.idle", {
        thread: makeThreadResponse(t1),
        lastAssistantText: null,
      });
      await vi.advanceTimersByTimeAsync(4_000);
      expect(spawned).toHaveLength(1);

      // Turning the setting off prevents auto-classification on new threads.
      await harness.behavior.callRpc("updateSidebarSettings", { autoClassifySections: false });
      await harness.behavior.emitThreadEvent("thread.idle", {
        thread: makeThreadResponse(t2),
        lastAssistantText: null,
      });
      await vi.advanceTimersByTimeAsync(4_000);
      expect(spawned).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("bulk-classifies unsorted threads via --all and --limit", async () => {
    const threads = [
      projectThread({ id: "thr_a", projectId: "proj_personal", title: "A", latestAttentionAt: 300 }),
      projectThread({ id: "thr_b", projectId: "proj_personal", title: "B", latestAttentionAt: 200 }),
      projectThread({
        id: "thr_c",
        projectId: "proj_personal",
        title: "C",
        sectionId: "sec_ops",
        latestAttentionAt: 100,
      }),
    ];
    const { bb, harness, updated } = setupHost({ threads, modelOutput: "Sales" });
    await plugin(bb);
    disposers.push(() => harness.lifecycle.dispose());

    const res = await harness.behavior.runCli(["classify", "--all", "--limit", "1", "--json"]);
    expect(res.exitCode).toBe(0);
    expect(JSON.parse(res.stdout)).toMatchObject({
      assigned: 1,
      results: [{ threadId: "thr_a", status: "assigned", section: { id: "sec_sales" } }],
    });
    expect(updated).toEqual([{ threadId: "thr_a", sectionId: "sec_sales" }]);
  });
});
