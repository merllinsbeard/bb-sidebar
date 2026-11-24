import type { BbPluginApi } from "@get-bb/plugin-sdk";

const MAX_PROMPT_CHARS = 1_200;
const MAX_EXAMPLES_PER_SECTION = 6;
const MAX_EXAMPLE_TITLE_CHARS = 70;
const MAX_EXAMPLE_PROJECT_CHARS = 40;
const MIN_PROJECT_HISTORY_THREADS = 2;
const MIN_PROJECT_HISTORY_SHARE = 0.8;

export const CLAUDE_SYSTEM_PROMPT =
  "You classify threads into one exact section name from the provided list, or NONE. Use each section's name, project tags, and example thread titles to infer its scope. Prefer NONE over guessing when a thread does not clearly match a section's topic or projects. Reply with only the exact section name (without examples or quotes) or NONE.";

export interface SectionCandidate {
  readonly id: string;
  readonly name: string;
}

export type SectionExampleThread = Pick<
  Awaited<ReturnType<BbPluginApi["sdk"]["threads"]["list"]>>[number],
  | "id"
  | "projectId"
  | "sectionId"
  | "parentThreadId"
  | "visibility"
  | "archivedAt"
  | "deletedAt"
  | "title"
  | "titleFallback"
  | "updatedAt"
  | "latestAttentionAt"
>;

const SECRET_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 [REDACTED]"],
  [/\b(Authorization\s*:\s*(?:[A-Za-z][A-Za-z0-9_-]*\s+)?)(?!\[REDACTED\])[A-Za-z0-9._~+/=-]{16,}/gi, "$1[REDACTED]"],
  [
    /(?<![A-Za-z0-9_-])(?:sk-(?:proj-|ant-|live-|test-)?[A-Za-z0-9_-]{12,}|sk_(?:live|test)_[A-Za-z0-9]{12,}|(?:gh[pousr]_|github_pat_|glpat-|dmcp_)[A-Za-z0-9_-]{10,}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{20,})/g,
    "[REDACTED]",
  ],
  [
    /(?<![A-Za-z0-9_-])((?:access_token|refresh_token|auth_token|x-api-key|api[_-]?key|token|secret)\s*[:=]\s*["']?)(?!\[REDACTED\])[A-Za-z0-9._~+/=-]{16,}/gi,
    "$1[REDACTED]",
  ],
];

export function redactSecrets(text: string): string {
  let result = text;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

export function isVisibleRootThread(
  thread: Pick<SectionExampleThread, "parentThreadId" | "visibility" | "archivedAt" | "deletedAt">,
): boolean {
  return (
    thread.parentThreadId === null &&
    thread.visibility === "visible" &&
    thread.archivedAt === null &&
    thread.deletedAt === null
  );
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

export function matchSectionByProjectHistory(
  projectId: string | null | undefined,
  isPersonal: boolean,
  threads: readonly SectionExampleThread[],
  sections: readonly SectionCandidate[],
  excludeThreadId: string,
): SectionCandidate | null {
  if (isPersonal || !projectId || sections.length === 0) return null;
  const sectionById = new Map(sections.map((section) => [section.id, section] as const));
  const counts = new Map<string, number>();
  const seen = new Set<string>();
  let total = 0;

  for (const thread of threads) {
    if (seen.has(thread.id)) continue;
    seen.add(thread.id);
    if (
      thread.id === excludeThreadId ||
      thread.projectId !== projectId ||
      thread.sectionId === null ||
      !sectionById.has(thread.sectionId) ||
      !isVisibleRootThread(thread)
    ) {
      continue;
    }
    counts.set(thread.sectionId, (counts.get(thread.sectionId) ?? 0) + 1);
    total += 1;
  }

  if (total < MIN_PROJECT_HISTORY_THREADS) return null;

  let topSectionId: string | null = null;
  let topCount = 0;
  let runnerUpCount = 0;
  for (const [sectionId, count] of counts) {
    if (count > topCount) {
      runnerUpCount = topCount;
      topCount = count;
      topSectionId = sectionId;
    } else if (count > runnerUpCount) {
      runnerUpCount = count;
    }
  }

  if (!topSectionId || topCount <= runnerUpCount || topCount / total < MIN_PROJECT_HISTORY_SHARE) {
    return null;
  }
  return sectionById.get(topSectionId) ?? null;
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

export function extractFirstUserPrompt(events: readonly unknown[]): string | null {
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

function sanitizeInlineText(raw: string | null | undefined, maxChars: number): string | null {
  if (!raw) return null;
  const cleaned = redactSecrets(raw).replace(/\s+/g, " ").replace(/"/g, "'").trim();
  if (!cleaned) return null;
  return cleaned.length <= maxChars ? cleaned : `${cleaned.slice(0, maxChars - 1).trimEnd()}…`;
}

export function collectSectionExamples(
  threads: readonly SectionExampleThread[],
  sections: readonly SectionCandidate[],
  excludeThreadId: string,
  projectNameById?: ReadonlyMap<string, string>,
  personalProjectIds?: ReadonlySet<string>,
): Map<string, string[]> {
  const knownSectionIds = new Set(sections.map((section) => section.id));
  const examples = new Map<string, string[]>();
  const seenThreadIds = new Set<string>();
  const recent = [...threads].sort(
    (left, right) =>
      Math.max(right.updatedAt, right.latestAttentionAt) - Math.max(left.updatedAt, left.latestAttentionAt) ||
      left.id.localeCompare(right.id),
  );
  for (const thread of recent) {
    if (seenThreadIds.has(thread.id)) continue;
    seenThreadIds.add(thread.id);
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
    const title =
      sanitizeInlineText(thread.title, MAX_EXAMPLE_TITLE_CHARS) ??
      sanitizeInlineText(thread.titleFallback, MAX_EXAMPLE_TITLE_CHARS);
    if (!title) continue;
    const projectName = !personalProjectIds?.has(thread.projectId)
      ? sanitizeInlineText(projectNameById?.get(thread.projectId), MAX_EXAMPLE_PROJECT_CHARS)
      : null;
    const formatted = projectName ? `[project: ${projectName}] ${title}` : title;
    if (list.includes(formatted)) continue;
    list.push(formatted);
    examples.set(thread.sectionId, list);
  }
  return examples;
}

export function buildClassificationPrompt(
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
  const redactedFallback = context.titleFallback ? redactSecrets(context.titleFallback) : null;
  const redactedPrompt = context.firstUserPrompt ? redactSecrets(context.firstUserPrompt) : null;
  const details = [
    context.projectName ? `Project: ${context.projectName}${context.isPersonal ? " (personal)" : ""}` : null,
    context.title ? `Title: ${redactSecrets(context.title)}` : null,
    !context.title && redactedFallback ? `Fallback title: ${redactedFallback}` : null,
    redactedPrompt ? `First message:\n${redactedPrompt}` : null,
  ]
    .filter((line): line is string => line !== null)
    .join("\n")
    .slice(0, MAX_PROMPT_CHARS);

  return [
    "Classify this thread into exactly one of the allowed sections below.",
    "Infer each section's scope from its name, project tags, and example thread titles.",
    "Prefer NONE over guessing when a thread does not clearly match a section's topic or projects.",
    "Reply with ONLY the exact section name (without examples or quotes), or NONE.",
    "Do not add explanations, quotes, markdown, or extra text.",
    "",
    "Allowed sections:",
    sectionList,
    "",
    "Thread context:",
    details,
  ].join("\n");
}
