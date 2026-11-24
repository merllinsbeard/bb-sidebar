import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import plugin from "./server";
import { matchSectionDeterministic, parseClassifiedSection } from "./server-auto-section";
import { createFakePluginHost, disposers, projectThread, projectsWith, standardProject } from "./test-server";

const SECTIONS = [
  { id: "sec_sidebar", name: "Sidebar", createdAt: 1, updatedAt: 1 },
  { id: "sec_ops", name: "Ops & Infra", createdAt: 2, updatedAt: 2 },
  { id: "sec_sales", name: "Sales", createdAt: 3, updatedAt: 3 },
];

const FAKE_CLAUDE = `#!/bin/sh
set -eu
count_file="$FAKE_CLAUDE_DIR/count"
n=0
if [ -f "$count_file" ]; then n=$(cat "$count_file"); fi
n=$((n + 1))
printf '%s' "$n" > "$count_file"
printf '%s\\n' "$@" > "$FAKE_CLAUDE_DIR/args-$n.txt"
pwd > "$FAKE_CLAUDE_DIR/cwd-$n.txt"
cat > "$FAKE_CLAUDE_DIR/stdin-$n.txt"
if [ "\${FAKE_CLAUDE_HANG:-}" = "1" ]; then
  echo $$ > "$FAKE_CLAUDE_DIR/pid"
  exec sleep 30
fi
if [ -n "\${FAKE_CLAUDE_STDERR:-}" ]; then
  printf '%s\\n' "$FAKE_CLAUDE_STDERR" >&2
fi
if [ -n "\${FAKE_CLAUDE_STDOUT:-}" ]; then
  printf '%s\\n' "$FAKE_CLAUDE_STDOUT"
fi
exit "\${FAKE_CLAUDE_EXIT:-0}"
`;

const FAKE_ENV_KEYS = [
  "FAKE_CLAUDE_DIR",
  "FAKE_CLAUDE_STDOUT",
  "FAKE_CLAUDE_STDERR",
  "FAKE_CLAUDE_EXIT",
  "FAKE_CLAUDE_HANG",
] as const;

describe("auto-section pure helpers", () => {
  it("matches non-personal project names and workspace slugs deterministically", () => {
    expect(matchSectionDeterministic("sidebar", false, null, SECTIONS)?.id).toBe("sec_sidebar");
    expect(matchSectionDeterministic("Other", false, "/home/merlin/Dev/projects/ops-infra", SECTIONS)?.id).toBe(
      "sec_ops",
    );
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
  const originalPath = process.env.PATH;
  let binDir: string;

  beforeEach(() => {
    const cache = join(import.meta.dirname, "..", "node_modules", ".cache");
    mkdirSync(cache, { recursive: true });
    binDir = mkdtempSync(join(cache, "fake-claude-"));
    writeFileSync(join(binDir, "claude"), FAKE_CLAUDE);
    chmodSync(join(binDir, "claude"), 0o755);
    process.env.PATH = `${binDir}:/usr/bin:/bin`;
    for (const key of FAKE_ENV_KEYS) delete process.env[key];
    process.env.FAKE_CLAUDE_DIR = binDir;
    process.env.FAKE_CLAUDE_STDOUT = "Sales";
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env.PATH = originalPath;
    for (const key of FAKE_ENV_KEYS) delete process.env[key];
    rmSync(binDir, { recursive: true, force: true });
  });

  function claudeCallCount(): number {
    const countFile = join(binDir, "count");
    return existsSync(countFile) ? Number(readFileSync(countFile, "utf8").trim()) : 0;
  }

  function claudeCall(index = 1) {
    return {
      args: readFileSync(join(binDir, `args-${index}.txt`), "utf8")
        .split("\n")
        .slice(0, -1),
      cwd: readFileSync(join(binDir, `cwd-${index}.txt`), "utf8").trim(),
      stdin: readFileSync(join(binDir, `stdin-${index}.txt`), "utf8"),
    };
  }

  function setupHost(options?: {
    threads?: ReturnType<typeof projectThread>[];
    projects?: ReturnType<typeof projectsWith>;
    sections?: typeof SECTIONS;
    eventsForThread?: (threadId: string) => unknown[];
    listThreads?: () => Promise<ReturnType<typeof projectThread>[]>;
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
    const defaultEvents = (threadId: string) => [
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
    ];

    const { bb, harness } = createFakePluginHost({
      pluginId: "bb-sidebar",
      sdk: {
        projects: { list: async () => projects as never },
        threadSections: { list: async () => sections as never },
        threads: {
          ...(options?.listThreads ? { list: options.listThreads as never } : {}),
          get: async ({ threadId }) => {
            const match = threads.find((t) => t.id === threadId);
            if (!match) throw new Error(`Unknown thread ${threadId}`);
            return makeThreadResponse(match);
          },
          events: {
            list: async ({ threadId }) =>
              (options?.eventsForThread ? options.eventsForThread(threadId) : defaultEvents(threadId)) as never,
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

    return { bb, harness, threads, updated };
  }

  async function triggerIdle(harness: ReturnType<typeof setupHost>["harness"], t: ReturnType<typeof projectThread>) {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      await harness.behavior.emitThreadEvent("thread.idle", {
        thread: makeThreadResponse(t),
        lastAssistantText: null,
      });
      await vi.advanceTimersByTimeAsync(4_000);
    } finally {
      vi.useRealTimers();
    }
  }

  it("classifies deterministically with zero claude invocations and supports --dry-run", async () => {
    const t = projectThread({ id: "thr_det", projectId: "proj_1", title: "Fix sidebar bug" });
    const { bb, harness, updated } = setupHost({
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
    expect(claudeCallCount()).toBe(0);

    const real = await harness.behavior.runCli(["classify", "--thread", "thr_det", "--json"]);
    expect(real.exitCode).toBe(0);
    expect(JSON.parse(real.stdout)).toMatchObject({
      assigned: 1,
      results: [{ threadId: "thr_det", status: "assigned", method: "deterministic", section: { id: "sec_sidebar" } }],
    });
    expect(updated).toEqual([{ threadId: "thr_det", sectionId: "sec_sidebar" }]);
    expect(claudeCallCount()).toBe(0);
  });

  it("invokes isolated claude haiku CLI from tmpdir, assigns matched section, and handles NONE as unmatched", async () => {
    const t2 = projectThread({ id: "thr_none", projectId: "proj_personal", title: "Random chat" });
    const { bb, harness, updated } = setupHost({
      threads: [projectThread({ id: "thr_1", projectId: "proj_personal", title: "Review Q4 sales deck" }), t2],
    });
    await plugin(bb);
    disposers.push(() => harness.lifecycle.dispose());

    const assigned = await harness.behavior.runCli(["classify", "--thread", "thr_1", "--json"]);
    expect(assigned.exitCode).toBe(0);
    expect(JSON.parse(assigned.stdout)).toMatchObject({
      assigned: 1,
      results: [{ threadId: "thr_1", status: "assigned", method: "model", section: { id: "sec_sales" } }],
    });
    expect(updated).toEqual([{ threadId: "thr_1", sectionId: "sec_sales" }]);

    expect(claudeCallCount()).toBe(1);
    const call = claudeCall(1);
    expect(call.cwd).toBe(tmpdir());
    expect(call.args).toEqual(
      expect.arrayContaining([
        "-p",
        "--safe-mode",
        "--model",
        "haiku",
        "--setting-sources",
        "",
        "--strict-mcp-config",
        "--mcp-config",
        '{"mcpServers":{}}',
        "--tools",
        "",
        "--disable-slash-commands",
        "--no-session-persistence",
        "--system-prompt",
      ]),
    );
    expect(call.stdin).toContain("- Sales");
    expect(call.stdin).toContain("Prepare sales proposal for enterprise lead");

    process.env.FAKE_CLAUDE_STDOUT = "NONE";
    const unmatched = await harness.behavior.runCli(["classify", "--thread", "thr_none", "--json"]);
    expect(unmatched.exitCode).toBe(0);
    expect(JSON.parse(unmatched.stdout)).toMatchObject({
      assigned: 0,
      unmatched: 1,
      results: [{ threadId: "thr_none", status: "unmatched", method: "model", section: null }],
    });
    expect(updated).toHaveLength(1);
  });

  it("surfaces claude CLI errors cleanly without leaking stdout", async () => {
    const { bb, harness } = setupHost();
    await plugin(bb);
    disposers.push(() => harness.lifecycle.dispose());

    process.env.FAKE_CLAUDE_EXIT = "3";
    process.env.FAKE_CLAUDE_STDERR = "rate limited";
    process.env.FAKE_CLAUDE_STDOUT = "";
    const withStderr = await harness.behavior.runCli(["classify", "--thread", "thr_1"]);
    expect(withStderr.exitCode).toBe(1);
    expect(withStderr.stderr).toContain("code 3: rate limited");

    process.env.FAKE_CLAUDE_EXIT = "4";
    process.env.FAKE_CLAUDE_STDERR = "";
    process.env.FAKE_CLAUDE_STDOUT = "secret prompt echo";
    const silentFail = await harness.behavior.runCli(["classify", "--thread", "thr_1"]);
    expect(silentFail.exitCode).toBe(1);
    expect(silentFail.stderr).toContain("code 4 and printed no error");
    expect(silentFail.stderr).not.toContain("secret");

    process.env.FAKE_CLAUDE_EXIT = "0";
    process.env.FAKE_CLAUDE_STDERR = "";
    process.env.FAKE_CLAUDE_STDOUT = "";
    const emptyReply = await harness.behavior.runCli(["classify", "--thread", "thr_1"]);
    expect(emptyReply.exitCode).toBe(1);
    expect(emptyReply.stderr).toContain("empty reply");

    process.env.PATH = "/nonexistent";
    const missingBin = await harness.behavior.runCli(["classify", "--thread", "thr_1"]);
    expect(missingBin.exitCode).toBe(1);
    expect(missingBin.stderr).toContain("not installed on PATH");
  });

  it("skips hidden, child, and already-sectioned threads unless --force is passed", async () => {
    const threads = [
      projectThread({ id: "thr_hidden", projectId: "proj_personal", visibility: "hidden" }),
      projectThread({ id: "thr_child", projectId: "proj_personal", parentThreadId: "thr_root" }),
      projectThread({ id: "thr_done", projectId: "proj_personal", sectionId: "sec_ops", title: "Already done" }),
    ];
    const { bb, harness, updated } = setupHost({ threads });
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
    expect(claudeCallCount()).toBe(0);
    expect(updated).toEqual([]);

    const forced = await harness.behavior.runCli(["classify", "--thread", "thr_done", "--force", "--json"]);
    expect(JSON.parse(forced.stdout)).toMatchObject({
      assigned: 1,
      results: [{ threadId: "thr_done", status: "assigned", section: { id: "sec_sales" } }],
    });
    expect(claudeCallCount()).toBe(1);
  });

  it("reads the first user prompt from client/turn/requested events when client/thread/start params are empty", async () => {
    const t = projectThread({ id: "thr_req", projectId: "proj_personal", title: null, titleFallback: null });
    const { bb, harness, updated } = setupHost({
      threads: [t],
      eventsForThread: (threadId) => [
        {
          id: "ev_0",
          seq: 0,
          threadId,
          createdAt: 1,
          scope: { kind: "thread" as const },
          type: "client/thread/start" as const,
          data: { request: { params: {} } },
        },
        {
          id: "ev_1",
          seq: 1,
          threadId,
          createdAt: 2,
          scope: { kind: "thread" as const },
          type: "client/turn/requested" as const,
          data: {
            input: [{ type: "text" as const, text: "Draft enterprise pricing quote for Acme" }],
          },
        },
      ],
    });
    await plugin(bb);
    disposers.push(() => harness.lifecycle.dispose());

    const res = await harness.behavior.runCli(["classify", "--thread", "thr_req", "--json"]);
    expect(res.exitCode).toBe(0);
    expect(updated).toEqual([{ threadId: "thr_req", sectionId: "sec_sales" }]);
    expect(claudeCall(1).stdin).toContain("Draft enterprise pricing quote for Acme");
  });

  it("includes recent sectioned thread examples while excluding target, child, and hidden threads, and tolerates list failures", async () => {
    const target = projectThread({
      id: "thr_target",
      projectId: "proj_personal",
      sectionId: "sec_sales",
      title: "Self title must not leak",
      updatedAt: 999,
    });
    const threads = [
      target,
      projectThread({
        id: "thr_sales_new",
        projectId: "proj_personal",
        sectionId: "sec_sales",
        title: 'Q4 enterprise\n  "VIP" renewal',
        updatedAt: 500,
      }),
      projectThread({
        id: "thr_sales_fallback",
        projectId: "proj_personal",
        sectionId: "sec_sales",
        title: null,
        titleFallback: "Cold outreach sequence",
        updatedAt: 400,
      }),
      projectThread({
        id: "thr_sales_child",
        projectId: "proj_personal",
        sectionId: "sec_sales",
        parentThreadId: "thr_sales_new",
        title: "Child thread excluded",
        updatedAt: 800,
      }),
      projectThread({
        id: "thr_sales_hidden",
        projectId: "proj_personal",
        sectionId: "sec_sales",
        visibility: "hidden",
        title: "Hidden thread excluded",
        updatedAt: 850,
      }),
      projectThread({
        id: "thr_ops_1",
        projectId: "proj_personal",
        sectionId: "sec_ops",
        title: "Rotate production TLS certificates",
        latestAttentionAt: 300,
      }),
    ];
    const { bb, harness } = setupHost({ threads });
    await plugin(bb);
    disposers.push(() => harness.lifecycle.dispose());

    const res = await harness.behavior.runCli(["classify", "--thread", "thr_target", "--force", "--dry-run", "--json"]);
    expect(res.exitCode).toBe(0);
    const stdin = claudeCall(1).stdin;
    expect(stdin).toContain('- Sales (examples: "Q4 enterprise \'VIP\' renewal"; "Cold outreach sequence")');
    expect(stdin).toContain('- Ops & Infra (examples: "Rotate production TLS certificates")');
    expect(stdin).toContain("\n- Sidebar\n");
    expect(stdin).not.toContain('examples: "Self title must not leak"');
    expect(stdin).not.toContain("Child thread excluded");
    expect(stdin).not.toContain("Hidden thread excluded");

    const failingHost = setupHost({
      threads: [projectThread({ id: "thr_fallback", projectId: "proj_personal", title: "Enterprise follow-up" })],
      listThreads: async () => {
        throw new Error("list unavailable");
      },
    });
    await plugin(failingHost.bb);
    disposers.push(() => failingHost.harness.lifecycle.dispose());

    const fallbackRes = await failingHost.harness.behavior.runCli(["classify", "--thread", "thr_fallback", "--json"]);
    expect(fallbackRes.exitCode).toBe(0);
    expect(failingHost.updated).toEqual([{ threadId: "thr_fallback", sectionId: "sec_sales" }]);
    expect(claudeCall(2).stdin).toContain("\n- Sales\n");
  });

  it("throttles automatic retries during failure cooldown, keeps CLI unblocked, and retries once cooldown expires", async () => {
    let now = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const t = projectThread({ id: "thr_retry", projectId: "proj_personal", title: "Enterprise sales" });
    const { bb, harness, updated } = setupHost({ threads: [t] });
    await plugin(bb);
    disposers.push(() => harness.lifecycle.dispose());

    process.env.FAKE_CLAUDE_EXIT = "2";
    process.env.FAKE_CLAUDE_STDERR = "temporary outage";
    process.env.FAKE_CLAUDE_STDOUT = "";
    await triggerIdle(harness, t);
    await vi.waitFor(() => expect(claudeCallCount()).toBe(1));
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(updated).toEqual([]);

    process.env.FAKE_CLAUDE_EXIT = "0";
    process.env.FAKE_CLAUDE_STDERR = "";
    process.env.FAKE_CLAUDE_STDOUT = "Sales";
    await triggerIdle(harness, t);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(claudeCallCount()).toBe(1);
    expect(updated).toEqual([]);

    const cliDryRun = await harness.behavior.runCli(["classify", "--thread", "thr_retry", "--dry-run", "--json"]);
    expect(cliDryRun.exitCode).toBe(0);
    expect(claudeCallCount()).toBe(2);

    now += 5 * 60 * 1_000 + 1;
    await triggerIdle(harness, t);
    await vi.waitFor(() => expect(updated).toEqual([{ threadId: "thr_retry", sectionId: "sec_sales" }]));
    expect(claudeCallCount()).toBe(3);
  });

  it("does not re-invoke claude after terminal assigned or unmatched decisions and respects autoClassifySections toggle", async () => {
    const tAssigned = projectThread({ id: "thr_auto", projectId: "proj_personal", title: "Enterprise sales" });
    const tUnmatched = projectThread({ id: "thr_unmatched", projectId: "proj_personal", title: "Misc note" });
    const tCli = projectThread({ id: "thr_cli", projectId: "proj_personal", title: "CLI classified" });
    const tOff = projectThread({ id: "thr_off", projectId: "proj_personal", title: "Ignored when off" });
    const { bb, harness, updated } = setupHost({ threads: [tAssigned, tUnmatched, tCli, tOff] });
    await plugin(bb);
    disposers.push(() => harness.lifecycle.dispose());

    await triggerIdle(harness, tAssigned);
    await vi.waitFor(() => expect(updated).toEqual([{ threadId: "thr_auto", sectionId: "sec_sales" }]));
    expect(claudeCallCount()).toBe(1);

    tAssigned.sectionId = null;
    await triggerIdle(harness, tAssigned);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(claudeCallCount()).toBe(1);

    process.env.FAKE_CLAUDE_STDOUT = "NONE";
    await triggerIdle(harness, tUnmatched);
    await vi.waitFor(() => expect(claudeCallCount()).toBe(2));
    await new Promise((resolve) => setTimeout(resolve, 40));
    await triggerIdle(harness, tUnmatched);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(claudeCallCount()).toBe(2);

    process.env.FAKE_CLAUDE_STDOUT = "Sales";
    const cliRes = await harness.behavior.runCli(["classify", "--thread", "thr_cli", "--json"]);
    expect(cliRes.exitCode).toBe(0);
    expect(claudeCallCount()).toBe(3);
    tCli.sectionId = null;
    await triggerIdle(harness, tCli);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(claudeCallCount()).toBe(3);

    await harness.behavior.callRpc("updateSidebarSettings", { autoClassifySections: false });
    await triggerIdle(harness, tOff);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(claudeCallCount()).toBe(3);
  });

  it("does not lock out a thread skipped for no_content so it classifies once content arrives", async () => {
    let hasContent = false;
    const t = projectThread({ id: "thr_empty", projectId: "proj_personal", title: null, titleFallback: null });
    const { bb, harness, updated } = setupHost({
      threads: [t],
      eventsForThread: () =>
        hasContent
          ? [
              {
                id: "ev_1",
                seq: 1,
                threadId: t.id,
                createdAt: 1,
                scope: { kind: "thread" as const },
                type: "item/completed" as const,
                data: {
                  item: {
                    id: "item_1",
                    type: "userMessage" as const,
                    content: [{ type: "text" as const, text: "Enterprise sales pipeline review" }],
                  },
                },
              },
            ]
          : [],
    });
    await plugin(bb);
    disposers.push(() => harness.lifecycle.dispose());

    await triggerIdle(harness, t);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(claudeCallCount()).toBe(0);
    expect(updated).toEqual([]);

    hasContent = true;
    await triggerIdle(harness, t);
    await vi.waitFor(() => expect(updated).toEqual([{ threadId: "thr_empty", sectionId: "sec_sales" }]));
    expect(claudeCallCount()).toBe(1);
  });

  it("aborts an in-flight claude process cleanly on plugin disposal", async () => {
    const { bb, harness } = setupHost();
    await plugin(bb);
    disposers.push(() => harness.lifecycle.dispose());

    process.env.FAKE_CLAUDE_HANG = "1";
    const pending = harness.behavior.runCli(["classify", "--thread", "thr_1"]);

    const pidFile = join(binDir, "pid");
    await vi.waitFor(() => expect(existsSync(pidFile)).toBe(true), { timeout: 3_000 });
    const pid = Number(readFileSync(pidFile, "utf8").trim());

    await harness.lifecycle.dispose();
    const res = await pending;
    expect(res.exitCode).toBe(1);
    await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow(), { timeout: 2_000 });
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
    const { bb, harness, updated } = setupHost({ threads });
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
