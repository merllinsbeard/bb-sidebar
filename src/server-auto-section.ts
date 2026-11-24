import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  CLAUDE_SYSTEM_PROMPT,
  type SectionCandidate,
  type SectionExampleThread,
  buildClassificationPrompt,
  collectSectionExamples,
  extractFirstUserPrompt,
  isVisibleRootThread,
  matchSectionByProjectHistory,
  matchSectionDeterministic,
  parseClassifiedSection,
} from "./server-auto-section-prompt";
import type { ServerContext } from "./server-context";
import type { createServerSettings } from "./server-settings";

export { matchSectionDeterministic, parseClassifiedSection };

const RECOVERY_DELAY_MS = 4_000;
const RETRY_COOLDOWN_MS = 5 * 60 * 1_000;
const MAX_CONCURRENT_CLASSIFICATIONS = 1;
const CLASSIFIER_TIMEOUT_MS = 30_000;
const PROJECT_HISTORY_FETCH_LIMIT = 50;
const SECTION_EXAMPLE_FETCH_LIMIT = 40;

const CLAUDE_ARGS = [
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
  CLAUDE_SYSTEM_PROMPT,
];

export const AUTO_SECTION_MIGRATION = `CREATE TABLE IF NOT EXISTS section_classification_attempts (
  thread_id TEXT PRIMARY KEY
)`;

export interface ClassifyThreadOptions {
  force?: boolean;
  dryRun?: boolean;
}

export interface SectionClassificationResult {
  threadId: string;
  status: "assigned" | "matched_dry_run" | "unmatched" | "skipped";
  method?: "deterministic" | "model";
  reason?: string;
  section: SectionCandidate | null;
}

async function resolveProjectContext(
  bb: BbPluginApi,
  projectId: string,
  environmentId: string | null,
  signal?: AbortSignal,
) {
  const projects = await bb.sdk.projects.list({ includePersonal: true, signal }).catch(() => null);
  const projectNameById = new Map<string, string>();
  const personalProjectIds = new Set<string>();
  for (const entry of projects ?? []) {
    if (entry.kind === "personal") {
      personalProjectIds.add(entry.id);
    } else if (entry.name.trim()) {
      projectNameById.set(entry.id, entry.name.trim());
    }
  }
  const project = projects?.find((entry) => entry.id === projectId);
  const defaultSource = project?.sources.find((source) => source.isDefault) ?? project?.sources[0];
  const environment = environmentId ? await bb.sdk.environments.get({ environmentId, signal }).catch(() => null) : null;
  return {
    projectName: project?.name ?? null,
    isPersonal: project?.kind === "personal",
    environmentPath: environment?.path ?? defaultSource?.path ?? null,
    projectNameById,
    personalProjectIds,
  };
}

function runClaude(prompt: string, signal: AbortSignal): Promise<string> {
  const runSignal = AbortSignal.any([signal, AbortSignal.timeout(CLASSIFIER_TIMEOUT_MS)]);
  return new Promise((resolve, reject) => {
    const child = spawn("claude", CLAUDE_ARGS, { cwd: tmpdir(), signal: runSignal });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.stdin.on("error", () => {});
    child.on("error", (error) => {
      reject(
        (error as NodeJS.ErrnoException).code === "ENOENT"
          ? new Error("Claude Code CLI (`claude`) is not installed on PATH")
          : error,
      );
    });
    child.on("close", (code) => {
      const text = stdout.trim();
      if (code === 0 && text) return resolve(text);
      if (code === 0) return reject(new Error("Claude Code returned an empty reply"));
      const detail = stderr.trim().slice(-500);
      const suffix = detail ? `: ${detail}` : " and printed no error";
      reject(new Error(`Claude Code exited with code ${code}${suffix}`));
    });
    child.stdin.end(prompt);
  });
}

export function createServerAutoSection(
  ctx: ServerContext,
  settings: Awaited<ReturnType<typeof createServerSettings>>,
) {
  const { bb, db } = ctx;
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const queued = new Set<string>();
  const running = new Set<string>();
  const failedCooldownUntil = new Map<string, number>();
  const controller = new AbortController();
  let disposed = false;

  const attempted = db.prepare("SELECT 1 FROM section_classification_attempts WHERE thread_id = ?");
  const recordAttempt = db.prepare("INSERT OR IGNORE INTO section_classification_attempts (thread_id) VALUES (?)");
  const release = db.prepare("DELETE FROM section_classification_attempts WHERE thread_id = ?");

  async function assignSection(
    threadId: string,
    section: SectionCandidate,
    method: "deterministic" | "model",
    dryRun: boolean | undefined,
  ): Promise<SectionClassificationResult> {
    if (!dryRun) {
      await bb.sdk.threads.update({ threadId, sectionId: section.id });
      recordAttempt.run(threadId);
      failedCooldownUntil.delete(threadId);
    }
    return {
      threadId,
      status: dryRun ? "matched_dry_run" : "assigned",
      method,
      section: { id: section.id, name: section.name },
    };
  }

  async function classifyThreadSection(
    threadId: string,
    options: ClassifyThreadOptions = {},
  ): Promise<SectionClassificationResult> {
    const signal = controller.signal;
    const [thread, sections] = await Promise.all([
      bb.sdk.threads.get({ threadId, signal }),
      bb.sdk.threadSections.list({ signal }),
    ]);

    const skip = (reason: string): SectionClassificationResult => ({
      threadId,
      status: "skipped",
      reason,
      section: null,
    });
    if (sections.length === 0) return skip("no_sections");
    if (thread.parentThreadId !== null) return skip("child_thread");
    if (thread.visibility !== "visible") return skip("not_visible");
    if (thread.archivedAt !== null) return skip("archived");
    if (thread.deletedAt !== null) return skip("deleted");
    if (!options.force && thread.sectionId !== null) return skip("already_sectioned");

    const { projectName, isPersonal, environmentPath, projectNameById, personalProjectIds } =
      await resolveProjectContext(bb, thread.projectId, thread.environmentId, signal);

    const deterministic = matchSectionDeterministic(projectName, isPersonal, environmentPath, sections);
    if (deterministic) return assignSection(threadId, deterministic, "deterministic", options.dryRun);

    if (!isPersonal) {
      const projectThreads = await bb.sdk.threads
        .list({
          projectId: thread.projectId,
          archived: false,
          hasParent: false,
          limit: PROJECT_HISTORY_FETCH_LIMIT,
          signal,
        })
        .catch(() => [] as SectionExampleThread[]);
      const byHistory = matchSectionByProjectHistory(thread.projectId, isPersonal, projectThreads, sections, threadId);
      if (byHistory) return assignSection(threadId, byHistory, "deterministic", options.dryRun);
    }

    const firstUserPrompt = await bb.sdk.threads.events
      .list({ threadId, limit: "20", order: "asc", signal })
      .then(extractFirstUserPrompt, () => null);

    if (!firstUserPrompt && !thread.title && !thread.titleFallback) return skip("no_content");

    const perSection = await Promise.all(
      sections.map((section) =>
        bb.sdk.threads
          .list({
            sectionId: section.id,
            archived: false,
            hasParent: false,
            limit: SECTION_EXAMPLE_FETCH_LIMIT,
            signal,
          })
          .catch(() => [] as SectionExampleThread[]),
      ),
    );
    const sectionExamples = collectSectionExamples(
      perSection.flat(),
      sections,
      threadId,
      projectNameById,
      personalProjectIds,
    );

    const prompt = buildClassificationPrompt(sections, {
      projectName,
      isPersonal,
      title: thread.title,
      titleFallback: thread.titleFallback,
      firstUserPrompt,
      sectionExamples,
    });

    const rawOutput = await runClaude(prompt, signal);
    const matched = parseClassifiedSection(rawOutput, sections);

    if (!matched) {
      if (!options.dryRun) {
        recordAttempt.run(threadId);
        failedCooldownUntil.delete(threadId);
      }
      return { threadId, status: "unmatched", method: "model", section: null };
    }

    return assignSection(threadId, matched, "model", options.dryRun);
  }

  async function runAutomaticClassification(threadId: string) {
    try {
      if (disposed || !settings.readSidebarSettings().autoClassifySections) return;
      if (attempted.get(threadId)) return;
      await classifyThreadSection(threadId);
    } catch (error) {
      if (!disposed) {
        failedCooldownUntil.set(threadId, Date.now() + RETRY_COOLDOWN_MS);
        const detail = error instanceof Error ? error.message : String(error);
        bb.log.info(`Automatic section classification did not complete for ${threadId}: ${detail}`);
      }
    }
  }

  function drain() {
    while (!disposed && running.size < MAX_CONCURRENT_CLASSIFICATIONS && queued.size > 0) {
      const threadId = queued.values().next().value!;
      queued.delete(threadId);
      running.add(threadId);
      void runAutomaticClassification(threadId).finally(() => {
        running.delete(threadId);
        drain();
      });
    }
  }

  bb.events.on("thread.idle", ({ thread }) => {
    if (
      disposed ||
      !settings.readSidebarSettings().autoClassifySections ||
      thread.sectionId !== null ||
      !isVisibleRootThread(thread) ||
      timers.has(thread.id) ||
      queued.has(thread.id) ||
      running.has(thread.id) ||
      (failedCooldownUntil.get(thread.id) ?? 0) > Date.now() ||
      attempted.get(thread.id)
    ) {
      return;
    }
    const timer = setTimeout(() => {
      timers.delete(thread.id);
      queued.add(thread.id);
      drain();
    }, RECOVERY_DELAY_MS);
    timer.unref?.();
    timers.set(thread.id, timer);
  });

  bb.events.on("thread.deleted", ({ thread }) => {
    clearTimeout(timers.get(thread.id));
    timers.delete(thread.id);
    queued.delete(thread.id);
    failedCooldownUntil.delete(thread.id);
    release.run(thread.id);
  });

  bb.onDispose(() => {
    disposed = true;
    controller.abort();
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    queued.clear();
    failedCooldownUntil.clear();
  });

  return { classifyThreadSection };
}
