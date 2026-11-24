import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { ServerContext } from "./server-context";
import type { createServerSettings } from "./server-settings";

const RECOVERY_DELAY_MS = 4_000;
const MAX_CONCURRENT_CLASSIFICATIONS = 1;
const CLASSIFIER_TIMEOUT_MS = 30_000;
const MAX_PROMPT_CHARS = 1_200;

const CLAUDE_SYSTEM_PROMPT =
  "You classify threads into one exact section name from the provided list, or NONE. Reply with only the exact section name or NONE.";
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

export interface SectionCandidate {
  readonly id: string;
  readonly name: string;
}

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

function normalizeLabel(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_\s-]+/g, " ")
    .replace(/\s+/g, " ");
}

function compactLabel(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function pathBasename(pathValue: string | null | undefined): string | null {
  if (!pathValue) return null;
  const parts = pathValue
    .trim()
    .split(/[/\\]+/)
    .filter((segment) => segment.length > 0);
  return parts.at(-1) ?? null;
}

/**
 * Match a non-personal project's name or workspace folder slug directly to a
 * live section name without spending an AI call.
 */
export function matchSectionDeterministic(
  projectName: string | null | undefined,
  isPersonal: boolean,
  environmentPath: string | null | undefined,
  sections: readonly SectionCandidate[],
): SectionCandidate | null {
  if (isPersonal || sections.length === 0) return null;
  const candidates = [projectName, pathBasename(environmentPath)]
    .map((value) => value?.trim() ?? "")
    .filter((value) => value.length > 0);
  if (candidates.length === 0) return null;

  for (const candidate of candidates) {
    const normalizedCandidate = normalizeLabel(candidate);
    const exact = sections.find((section) => normalizeLabel(section.name) === normalizedCandidate);
    if (exact) return exact;
  }

  for (const candidate of candidates) {
    const compactedCandidate = compactLabel(candidate);
    if (compactedCandidate.length === 0) continue;
    const compact = sections.find((section) => compactLabel(section.name) === compactedCandidate);
    if (compact) return compact;
  }

  return null;
}

function stripFormatting(value: string): string {
  let cleaned = value.trim();
  cleaned = cleaned.replace(/^```[\w-]*\s*/u, "").replace(/\s*```$/u, "");
  cleaned = cleaned.replace(/^(?:section|category)\s*:\s*/iu, "");
  cleaned = cleaned.replace(/^[`"'«»*_\s]+|[`"'«»*_\s]+$/gu, "").trim();
  return cleaned;
}

/**
 * Strictly match model output against live section names. Returns null for
 * NONE, empty output, or any unrecognized label.
 */
export function parseClassifiedSection(
  rawOutput: string | null | undefined,
  sections: readonly SectionCandidate[],
): SectionCandidate | null {
  if (!rawOutput || sections.length === 0) return null;
  const lines = rawOutput
    .split(/\r?\n/)
    .map((line) => stripFormatting(line))
    .filter((line) => line.length > 0);
  if (lines.length === 0) return null;

  const first = lines[0]!;
  if (/^none$/iu.test(first)) return null;

  const byLower = new Map(sections.map((section) => [section.name.trim().toLowerCase(), section] as const));
  const exactFirst = byLower.get(first.toLowerCase());
  if (exactFirst) return exactFirst;

  const last = lines.at(-1)!;
  if (/^none$/iu.test(last)) return null;
  return byLower.get(last.toLowerCase()) ?? null;
}

function extractTextParts(parts: unknown): string {
  if (!Array.isArray(parts)) return "";
  return parts
    .flatMap((part) => {
      if (typeof part === "string") return [part];
      if (part && typeof part === "object" && (part as { type?: unknown }).type === "text") {
        const text = (part as { text?: unknown }).text;
        return typeof text === "string" ? [text] : [];
      }
      return [];
    })
    .join("\n")
    .trim();
}

function extractFirstUserPrompt(events: readonly unknown[]): string | null {
  for (const raw of events) {
    if (!raw || typeof raw !== "object") continue;
    const event = raw as { type?: unknown; data?: Record<string, unknown> };
    const data = event.data;
    if (!data || typeof data !== "object") continue;

    if (event.type === "item/started" || event.type === "item/completed") {
      const item = data.item as { type?: unknown; content?: unknown } | undefined;
      if (item?.type === "userMessage") {
        const text = extractTextParts(item.content);
        if (text) return text;
      }
    }
    if (event.type === "client/thread/start" || event.type === "client/turn/start") {
      const request = data.request as { params?: Record<string, unknown> } | undefined;
      const params = request?.params;
      if (params && typeof params === "object") {
        const fromInput = extractTextParts(params.input);
        if (fromInput) return fromInput;
        if (typeof params.prompt === "string" && params.prompt.trim().length > 0) {
          return params.prompt.trim();
        }
      }
    }
  }
  return null;
}

function buildClassificationPrompt(
  sections: readonly SectionCandidate[],
  context: {
    projectName: string | null;
    isPersonal: boolean;
    title: string | null;
    titleFallback: string | null;
    firstUserPrompt: string | null;
  },
): string {
  const sectionList = sections.map((section) => `- ${section.name}`).join("\n");
  const details = [
    context.projectName ? `Project: ${context.projectName}${context.isPersonal ? " (personal)" : ""}` : null,
    context.title ? `Title: ${context.title}` : null,
    !context.title && context.titleFallback ? `Fallback title: ${context.titleFallback}` : null,
    context.firstUserPrompt ? `First message:\n${context.firstUserPrompt}` : null,
  ]
    .filter((line): line is string => line !== null)
    .join("\n")
    .slice(0, MAX_PROMPT_CHARS);

  return [
    "Classify this thread into exactly one of the allowed sections below.",
    "Reply with ONLY the exact section name from the list, or NONE if no section clearly fits.",
    "Do not add explanations, quotes, markdown, or extra text.",
    "",
    "Allowed sections:",
    sectionList,
    "",
    "Thread context:",
    details,
  ].join("\n");
}

async function resolveProjectContext(
  bb: BbPluginApi,
  projectId: string,
  environmentId: string | null,
  signal?: AbortSignal,
): Promise<{ projectName: string | null; isPersonal: boolean; environmentPath: string | null }> {
  let projectName: string | null = null;
  let isPersonal = false;
  let environmentPath: string | null = null;
  try {
    const projects = await bb.sdk.projects.list({ includePersonal: true, signal });
    const project = projects.find((entry) => entry.id === projectId);
    if (project) {
      projectName = project.name;
      isPersonal = project.kind === "personal";
      const defaultSource = project.sources.find((source) => source.isDefault) ?? project.sources[0];
      environmentPath = defaultSource?.path ?? null;
    }
  } catch {
    // Missing project metadata falls back to prompt-based classification.
  }

  if (environmentId) {
    try {
      const environment = await bb.sdk.environments.get({ environmentId, signal });
      if (environment.path) environmentPath = environment.path;
    } catch {
      // Keep the project source path if the environment lookup fails.
    }
  }
  return { projectName, isPersonal, environmentPath };
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
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new Error("Claude Code CLI (`claude`) is not installed on PATH"));
        return;
      }
      reject(error);
    });
    child.on("close", (code) => {
      const text = stdout.trim();
      if (code === 0 && text !== "") {
        resolve(text);
        return;
      }
      if (code === 0) {
        reject(new Error("Claude Code returned an empty reply"));
        return;
      }
      const detail = stderr.trim().slice(-500);
      reject(
        new Error(
          detail
            ? `Claude Code exited with code ${code}: ${detail}`
            : `Claude Code exited with code ${code} and printed no error`,
        ),
      );
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
  const controller = new AbortController();
  let disposed = false;

  const attempted = db.prepare("SELECT 1 FROM section_classification_attempts WHERE thread_id = ?");
  const recordAttempt = db.prepare("INSERT OR IGNORE INTO section_classification_attempts (thread_id) VALUES (?)");
  const release = db.prepare("DELETE FROM section_classification_attempts WHERE thread_id = ?");

  async function classifyThreadSection(
    threadId: string,
    options: ClassifyThreadOptions = {},
  ): Promise<SectionClassificationResult> {
    const signal = controller.signal;
    const [thread, sections] = await Promise.all([
      bb.sdk.threads.get({ threadId, signal }),
      bb.sdk.threadSections.list({ signal }),
    ]);

    if (sections.length === 0) return { threadId, status: "skipped", reason: "no_sections", section: null };
    if (thread.parentThreadId !== null) return { threadId, status: "skipped", reason: "child_thread", section: null };
    if (thread.visibility !== "visible") return { threadId, status: "skipped", reason: "not_visible", section: null };
    if (thread.archivedAt !== null) return { threadId, status: "skipped", reason: "archived", section: null };
    if (thread.deletedAt !== null) return { threadId, status: "skipped", reason: "deleted", section: null };
    if (!options.force && thread.sectionId !== null) {
      return { threadId, status: "skipped", reason: "already_sectioned", section: null };
    }

    const { projectName, isPersonal, environmentPath } = await resolveProjectContext(
      bb,
      thread.projectId,
      thread.environmentId,
      signal,
    );

    const deterministic = matchSectionDeterministic(projectName, isPersonal, environmentPath, sections);
    if (deterministic) {
      if (!options.dryRun) {
        await bb.sdk.threads.update({ threadId, sectionId: deterministic.id });
        recordAttempt.run(threadId);
      }
      return {
        threadId,
        status: options.dryRun ? "matched_dry_run" : "assigned",
        method: "deterministic",
        section: { id: deterministic.id, name: deterministic.name },
      };
    }

    let firstUserPrompt: string | null = null;
    try {
      const events = await bb.sdk.threads.events.list({ threadId, limit: "20", order: "asc", signal });
      firstUserPrompt = extractFirstUserPrompt(events);
    } catch {
      // Fall back to thread title if events cannot be read.
    }

    if (!firstUserPrompt && !thread.title && !thread.titleFallback) {
      return { threadId, status: "skipped", reason: "no_content", section: null };
    }

    const prompt = buildClassificationPrompt(sections, {
      projectName,
      isPersonal,
      title: thread.title,
      titleFallback: thread.titleFallback,
      firstUserPrompt: firstUserPrompt?.slice(0, MAX_PROMPT_CHARS) ?? null,
    });

    const rawOutput = await runClaude(prompt, signal);
    const matched = parseClassifiedSection(rawOutput, sections);

    if (!matched) {
      if (!options.dryRun) {
        recordAttempt.run(threadId);
      }
      return { threadId, status: "unmatched", method: "model", section: null };
    }

    if (!options.dryRun) {
      await bb.sdk.threads.update({ threadId, sectionId: matched.id });
      recordAttempt.run(threadId);
    }
    return {
      threadId,
      status: options.dryRun ? "matched_dry_run" : "assigned",
      method: "model",
      section: { id: matched.id, name: matched.name },
    };
  }

  async function runAutomaticClassification(threadId: string) {
    try {
      if (disposed || !settings.readSidebarSettings().autoClassifySections) return;
      if (attempted.get(threadId)) return;
      await classifyThreadSection(threadId);
    } catch (error) {
      if (!disposed) {
        bb.log.info(
          `Automatic section classification did not complete for ${threadId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
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
      thread.parentThreadId !== null ||
      thread.visibility !== "visible" ||
      thread.archivedAt !== null ||
      thread.deletedAt !== null ||
      timers.has(thread.id) ||
      queued.has(thread.id) ||
      running.has(thread.id) ||
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
    release.run(thread.id);
  });

  bb.onDispose(() => {
    disposed = true;
    controller.abort();
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    queued.clear();
  });

  return { classifyThreadSection };
}
