/*
 * Deterministic final-response sanitizer for ONEE.
 *
 * The canonical response is rendered in chat AND spoken via Groq Orpheus from
 * the exact same string, so this runs at the single write-time choke point in
 * useChatAgent. It is pure string processing — NO LLM ever rewrites verified
 * numbers: course codes, percentages, dates, times, rooms and seats pass
 * through untouched.
 *
 * Removes:
 *  - raw JSON wrappers (whole-message JSON with a known text field)
 *  - tool/diagnostic artifacts (single-line JSON objects/arrays)
 *  - JS runtime leakage: `undefined`, `[object Object]`, standalone `NaN`
 *  - exact duplicate sentences / repeated fragments
 *  - broken whitespace (trailing spaces, >2 blank lines)
 */

const KNOWN_TEXT_FIELDS = ['reply', 'message', 'content', 'text', 'answer', 'response'] as const;

function pickTextField(parsed: unknown): string | null {
  if (typeof parsed === 'string') return parsed;
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;
    for (const field of KNOWN_TEXT_FIELDS) {
      const value = obj[field];
      if (typeof value === 'string' && value.trim()) return value;
    }
  }
  return null;
}

function stripCodeFences(text: string): string {
  // ```json ... ``` / ``` ... ``` → inner content (JSON unwrapping happens next).
  return text.replace(/```[a-zA-Z0-9_-]*\s*([\s\S]*?)```/g, (_m, inner: string) =>
    String(inner).trim()
  );
}

function stripRawJson(text: string): string {
  const trimmed = text.trim();
  if (!/^[[{]/.test(trimmed)) return text;

  // Whole-message JSON with a recognized text field → unwrap to that string.
  try {
    const parsed = JSON.parse(trimmed);
    const candidate = pickTextField(parsed);
    if (candidate) return candidate.trim();
  } catch {
    /* not a single valid JSON document — fall through to line filtering */
  }
  return text;
}

function dropJsonArtifactLines(text: string): string {
  return text
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      // Preserve blank lines: paragraph and list structure depends on them.
      if (!t) return true;
      const starts = t.startsWith('{') || t.startsWith('[') || t.startsWith('"{') || t.startsWith('"[');
      const ends = t.endsWith('}') || t.endsWith(']') || t.endsWith('"}') || t.endsWith('"]');
      // Single-line JSON / tool-trace fragments are artifacts, never prose.
      return !(starts && ends && (t.includes('":') || t.includes('",')));
    })
    .join('\n');
}

function stripJsArtifacts(text: string): string {
  return text
    .replace(/\[object Object\]/g, ' ')
    // Standalone `undefined` token only (never inside words like "undefinedness"
    // is not a concern here; word boundary keeps identifiers like `redefined`).
    .replace(/(^|[^A-Za-z0-9_])undefined([^A-Za-z0-9_]|$)/g, '$1 $2')
    // Standalone NaN numeric artifact.
    .replace(/(^|[^A-Za-z0-9_])NaN([^A-Za-z0-9_]|$)/g, '$1 $2');
}

function dedupeSentences(text: string): string {
  // Exact duplicate sentences are removed (first occurrence kept) while the
  // ORIGINAL inter-sentence whitespace is preserved — so newlines, paragraph
  // breaks, markdown lists and table rows survive intact. Verified tabular
  // rows never match this pattern unless the full row is an exact duplicate.
  const parts = text.split(/(?<=[.!?])(\s+)/);
  const seen = new Set<string>();
  let out = '';
  for (let i = 0; i < parts.length; i += 2) {
    const sentence = parts[i];
    const sep = parts[i + 1] ?? '';
    const key = sentence.trim();
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out += sentence + sep;
  }
  return out;
}

function dedupeExactLines(text: string): string {
  // Exact duplicate non-blank lines (repeated fragments: list items, table
  // rows) are removed, keeping the first occurrence. Blank lines are kept.
  const seen = new Set<string>();
  return text
    .split('\n')
    .filter((line) => {
      const key = line.trim();
      if (!key) return true;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join('\n');
}

function fixWhitespace(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Deterministically sanitizes the FINAL canonical response for chat render and
 * voice delivery. Factual values are never altered — only artifacts around
 * them are removed.
 */
export function sanitizeFinalResponseText(raw: string): string {
  if (!raw || !raw.trim()) return '';

  let text = String(raw);
  text = stripCodeFences(text);
  text = stripRawJson(text);
  text = dropJsonArtifactLines(text);
  text = stripJsArtifacts(text);
  text = dedupeSentences(text);
  text = dedupeExactLines(text);
  text = fixWhitespace(text);
  return text;
}
