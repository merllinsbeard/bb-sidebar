import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { ServerContext } from "./server-context";
import type { createServerSettings } from "./server-settings";

const RECOVERY_DELAY_MS = 4_000;
const RETRY_COOLDOWN_MS = 5 * 60 * 1_000;
const MAX_CONCURRENT_CLASSIFICATIONS = 1;
const CLASSIFIER_TIMEOUT_MS = 30_000;
const MAX_PROMPT_CHARS = 1_200;
const SECTION_EXAMPLE_FETCH_LIMIT = 12;
const MAX_EXAMPLES_PER_SECTION = 6;
const MAX_EXAMPLE_TITLE_CHARS = 70;

const CLAUDE_SYSTEM_PROMPT =
  "You classify threads into one exact section name from the provided list, or NONE. Use each section's name and example thread titles to infer its scope. Reply with only the exact section name (without examples or quotes) or NONE.";
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
    .replace(/[_\s-]+/g, " ");
}

function compactLabel(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function pathBasename(pathValue: string | null | undefined): string | null {
  return (
    pathValue
      ?.trim()
      .split(/[/\\]+/)
      .filter(Boolean)
      .at(-1) ?? null
  );
}

export function matchSectionDeterministic(
  projectName: string | null | undefined,
  isPersonal: boolean,
  environmentPath: string | null | undefined,
  sections: readonly SectionCandidate[],
): SectionCandidate | null {
  if (isPersonal || sections.length === 0) return null;
  const candidates = [projectName, pathBasename(environmentPath)].map((value) => value?.trim() ?? "").filter(Boolean);
  if (candidates.length === 0) return null;

  for (const normalize of [normalizeLabel, compactLabel]) {
    for (const candidate of candidates) {
      const key = normalize(candidate);
      if (!key) continue;
      const found = sections.find((section) => normalize(section.name) === key);
      if (found) return found;
    }
  }
  return null;
}

function stripFormatting(value: string): string {
  return value
    .trim()
    .replace(/^```[\w-]*\s*/u, "")
    .replace(/\s*```$/u, "")
    .replace(/^(?:section|category)\s*:\s*/iu, "")
    .replace(/^[`"'«»*_\s]+|[`"'«»*_\s]+$/gu, "")
    .trim();
}

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

  const byLower = new Map(sections.map((section) => [section.name.trim().toLowerCase(), section] as const));
  for (const line of [lines[0]!, lines.at(-1)!]) {
    if (/^none$/iu.test(line)) return null;
    const match = byLower.get(line.toLowerCase());
    if (match) return match;
  }
  return null;
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

function extractPromptPayload(payload: Record<string, unknown>): string | null {
  const fromInput = extractTextParts(payload.input);
  if (fromInput) return fromInput;
  const prompt = typeof payload.prompt === "string" ? payload.prompt.trim() : "";
  return prompt || null;
}

function extractFirstUserPrompt(events: readonly unknown[]): string | null {
  for (const raw of events) {
    if (!raw || typeof raw !== "object") continue;
    const { type, data } = raw as { type?: unknown; data?: Record<string, unknown> };
    if (!data || typeof data !== "object") continue;
    if (type === "client/turn/requested") {
      const text = extractPromptPayload(data);
      if (text) return text;
    } else if (type === "item/started" || type === "item/completed") {
      const item = data.item as { type?: unknown; content?: unknown } | undefined;
      const text = item?.type === "userMessage" ? extractTextParts(item.content) : "";
      if (text) return text;
    } else if (type === "client/thread/start" || type === "client/turn/start") {
      const params = (data.request as { params?: Record<string, unknown> } | undefined)?.params;
      const text = params && typeof params === "object" ? extractPromptPayload(params) : null;
      if (text) return text;
    }
  }
  return null;
}

type ExampleThread = Awaited<ReturnType<BbPluginApi["sdk"]["threads"]["list"]>>[number];

function isVisibleRootThread(
  thread: Pick<ExampleThread, "parentThreadId" | "visibility" | "archivedAt" | "deletedAt">,
): boolean {
  return (
    thread.parentThreadId === null &&
    thread.visibility === "visible" &&
    thread.archivedAt === null &&
    thread.deletedAt === null
  );
}

function sanitizeExampleTitle(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/\s+/g, " ").replace(/"/g, "'").trim();
  if (!cleaned) return null;
  return cleaned.length <= MAX_EXAMPLE_TITLE_CHARS
    ? cleaned
    : `${cleaned.slice(0, MAX_EXAMPLE_TITLE_CHARS - 1).trimEnd()}…`;
}

function collectSectionExamples(
  threads: readonly ExampleThread[],
  sections: readonly SectionCandidate[],
  excludeThreadId: string,
): Map<string, string[]> {
  const knownSectionIds = new Set(sections.map((section) => section.id));
  const examples = new Map<string, string[]>();
  const recent = [...threads].sort(
    (left, right) =>
      Math.max(right.updatedAt, right.latestAttentionAt) - Math.max(left.updatedAt, left.latestAttentionAt) ||
      left.id.localeCompare(right.id),
  );
  for (const thread of recent) {
    if (
      thread.id === excludeThreadId ||
      thread.sectionId === null ||
      !knownSectionIds.has(thread.sectionId) ||
      !isVisibleRootThread(thread)
    ) {
      continue;
    }
    const list = examples.get(thread.sectionId) ?? [];
    if (list.length >= MAX_EXAMPLES_PER_SECTION) continue;
    const title = sanitizeExampleTitle(thread.title) ?? sanitizeExampleTitle(thread.titleFallback);
    if (!title || list.includes(title)) continue;
    list.push(title);
    examples.set(thread.sectionId, list);
  }
  return examples;
}

function buildClassificationPrompt(
  sections: readonly SectionCandidate[],
  context: {
    projectName: string | null;
    isPersonal: boolean;
    title: string | null;
    titleFallback: string | null;
    firstUserPrompt: string | null;
    sectionExamples?: ReadonlyMap<string, readonly string[]>;
  },
): string {
  const sectionList = sections
    .map((section) => {
      const examples = context.sectionExamples?.get(section.id);
      return examples?.length
        ? `- ${section.name} (examples: ${examples.map((title) => `"${title}"`).join("; ")})`
        : `- ${section.name}`;
    })
    .join("\n");
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
    "Infer each section's scope from its name and example thread titles.",
    "Reply with ONLY the exact section name (without examples or quotes), or NONE if the thread clearly does not belong to any section.",
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
) {
  const projects = await bb.sdk.projects.list({ includePersonal: true, signal }).catch(() => null);
  const project = projects?.find((entry) => entry.id === projectId);
  const defaultSource = project?.sources.find((source) => source.isDefault) ?? project?.sources[0];
  const environment = environmentId ? await bb.sdk.environments.get({ environmentId, signal }).catch(() => null) : null;
  return {
    projectName: project?.name ?? null,
    isPersonal: project?.kind === "personal",
    environmentPath: environment?.path ?? defaultSource?.path ?? null,
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

    const { projectName, isPersonal, environmentPath } = await resolveProjectContext(
      bb,
      thread.projectId,
      thread.environmentId,
      signal,
    );

    const deterministic = matchSectionDeterministic(projectName, isPersonal, environmentPath, sections);
    if (deterministic) return assignSection(threadId, deterministic, "deterministic", options.dryRun);

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
          .catch(() => [] as ExampleThread[]),
      ),
    );
    const sectionExamples = collectSectionExamples(perSection.flat(), sections, threadId);

    const prompt = buildClassificationPrompt(sections, {
      projectName,
      isPersonal,
      title: thread.title,
      titleFallback: thread.titleFallback,
      firstUserPrompt: firstUserPrompt?.slice(0, MAX_PROMPT_CHARS) ?? null,
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
