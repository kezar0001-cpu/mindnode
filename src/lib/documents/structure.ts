// Document structure parser. Pure function, no IO.
// Detects sections from a plain-text body using a small ordered set of
// heading heuristics: Markdown ATX, Markdown Setext, ALL-CAPS lines, and
// Title-Case lines that look like headings. Falls back to a single
// "Document" section if no headings are found.

export type DocumentSection = {
  id: string;
  index: number;
  title: string;
  level: number;
  content: string;
  char_count: number;
  word_count: number;
  bullet_count: number;
  start_offset: number;
  end_offset: number;
};

export type ParsedDocumentStructure = {
  document_title: string;
  sections: DocumentSection[];
};

type LineInfo = {
  text: string;
  rawText: string;
  start: number;
  end: number;
};

// Pre-split lines and keep original char offsets so we can record
// start_offset / end_offset on each section.
function splitLinesWithOffsets(text: string): LineInfo[] {
  const lines: LineInfo[] = [];
  let cursor = 0;
  const parts = text.split(/\n/);
  for (let i = 0; i < parts.length; i++) {
    const raw = parts[i];
    const start = cursor;
    const end = cursor + raw.length;
    lines.push({ text: raw.trim(), rawText: raw, start, end });
    cursor = end + 1; // account for the consumed '\n'
  }
  return lines;
}

function isSeparator(line: string): boolean {
  if (!line) return false;
  return /^[=\-_*]{3,}$/.test(line);
}

function countWords(text: string): number {
  const t = text.trim();
  if (!t) return 0;
  return t.split(/\s+/).length;
}

function countBullets(content: string): number {
  let n = 0;
  for (const line of content.split(/\n/)) {
    if (/^\s*[-*•·]\s/.test(line) || /^\s*\d+[.)]\s/.test(line)) n += 1;
  }
  return n;
}

// ATX markdown heading: # to ###### followed by space + text.
function atxHeading(line: string): { level: number; title: string } | null {
  const m = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
  if (!m) return null;
  return { level: m[1].length, title: m[2].trim() };
}

// Setext-style: previous line is a heading if the *next* non-empty line is
// === (level 1) or --- (level 2). We compute this externally by peeking
// ahead in the line array so we don't repeat the regex.
function isSetextUnderline(line: string): 1 | 2 | null {
  if (/^={3,}\s*$/.test(line)) return 1;
  if (/^-{3,}\s*$/.test(line)) return 2;
  return null;
}

// ALL-CAPS heading. Accepts a trimmed line of length 2..80 where ≥60% of
// the alphabetic characters are uppercase. Excludes trailing ":word"
// patterns and purely punctuation lines.
function isAllCapsHeading(line: string): boolean {
  if (line.length < 2 || line.length > 80) return false;
  // Reject "Foo: bar baz" style key:value lines.
  if (/^[^:\n]+:\s+\S/.test(line)) return false;
  const letters = line.match(/[A-Za-z]/g);
  if (!letters || letters.length < 2) return false;
  const upper = line.match(/[A-Z]/g) ?? [];
  if (upper.length / letters.length < 0.6) return false;
  // No sentence-ending punctuation, but allow ALL-CAPS WITH NUMBERS.
  if (/[.?!]$/.test(line)) return false;
  // Pure punctuation guard.
  if (/^[\W_]+$/.test(line)) return false;
  return true;
}

// Title-Case heading. Most words start with an uppercase letter, length
// 4..80, ends without a period, and the next line is blank (we check that
// outside this function).
function isTitleCaseHeading(line: string): boolean {
  if (line.length < 4 || line.length > 80) return false;
  if (/[.?!]$/.test(line)) return false;
  if (!/^[A-Z]/.test(line)) return false;
  const words = line.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 12) return false;
  let upperStart = 0;
  for (const w of words) {
    if (/^[A-Z0-9]/.test(w)) upperStart += 1;
  }
  return upperStart / words.length >= 0.6;
}

type HeadingHit = { lineIdx: number; level: number; title: string; consume: number };

function detectHeadings(lines: LineInfo[]): HeadingHit[] {
  const hits: HeadingHit[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].text;
    if (!line) continue;

    // 1. ATX markdown
    const atx = atxHeading(line);
    if (atx) {
      hits.push({ lineIdx: i, level: atx.level, title: atx.title, consume: 1 });
      continue;
    }

    // 2. Setext — current line is title, next non-empty is === / ---
    let nextIdx = i + 1;
    while (nextIdx < lines.length && !lines[nextIdx].text) nextIdx += 1;
    if (nextIdx < lines.length) {
      const lvl = isSetextUnderline(lines[nextIdx].text);
      if (lvl !== null && !isSeparator(line) && line.length >= 2 && line.length <= 120) {
        hits.push({
          lineIdx: i,
          level: lvl,
          title: line,
          consume: nextIdx - i + 1,
        });
        i = nextIdx; // skip past the underline so we don't reuse it
        continue;
      }
    }

    // Skip pure separators so they don't trigger heuristics.
    if (isSeparator(line)) continue;

    // 3. ALL CAPS — needs a body line after it (within next 3 non-blank lines).
    if (isAllCapsHeading(line)) {
      let hasFollow = false;
      for (let j = i + 1; j < Math.min(lines.length, i + 6); j++) {
        if (lines[j].text && !isSeparator(lines[j].text)) {
          hasFollow = true;
          break;
        }
      }
      if (hasFollow) {
        hits.push({ lineIdx: i, level: 1, title: line, consume: 1 });
        continue;
      }
    }

    // 4. Title Case — require a following blank line and then content.
    if (isTitleCaseHeading(line)) {
      const next = lines[i + 1];
      if (next && next.text === "") {
        let hasContent = false;
        for (let j = i + 2; j < Math.min(lines.length, i + 8); j++) {
          if (lines[j].text && !isSeparator(lines[j].text)) {
            hasContent = true;
            break;
          }
        }
        if (hasContent) {
          hits.push({ lineIdx: i, level: 2, title: line, consume: 1 });
          continue;
        }
      }
    }
  }
  return hits;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max).trimEnd();
}

function safeRandomId(): string {
  // Use crypto when available; fall back to a non-cryptographic id.
  try {
    if (typeof globalThis.crypto?.randomUUID === "function") {
      return globalThis.crypto.randomUUID();
    }
  } catch {
    // ignore
  }
  return `sec-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

function deriveDocumentTitle(text: string, firstHeading: string | null): string {
  if (firstHeading && firstHeading.trim()) {
    return truncate(firstHeading.trim(), 120);
  }
  const firstLine = text.split(/\n/).find((l) => l.trim().length > 0);
  if (firstLine) return truncate(firstLine.trim(), 80);
  return "Untitled Document";
}

export function parseDocumentStructure(text: string): ParsedDocumentStructure {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = splitLinesWithOffsets(normalized);
  const hits = detectHeadings(lines);

  if (hits.length === 0) {
    const body = normalized.trim();
    const word_count = countWords(body);
    if (body.length === 0) {
      return { document_title: "Empty Document", sections: [] };
    }
    return {
      document_title: deriveDocumentTitle(normalized, null),
      sections: [
        {
          id: safeRandomId(),
          index: 0,
          title: "Document",
          level: 1,
          content: body,
          char_count: body.length,
          word_count,
          bullet_count: countBullets(body),
          start_offset: 0,
          end_offset: body.length,
        },
      ],
    };
  }

  const sections: DocumentSection[] = [];
  for (let i = 0; i < hits.length; i++) {
    const hit = hits[i];
    const bodyStartLine = hit.lineIdx + hit.consume;
    const nextHit = hits[i + 1];
    const bodyEndLine = nextHit ? nextHit.lineIdx : lines.length;

    const bodyLines: string[] = [];
    for (let j = bodyStartLine; j < bodyEndLine; j++) {
      const raw = lines[j].rawText;
      if (j === bodyStartLine && raw.trim() === "") continue;
      bodyLines.push(raw);
    }
    const content = bodyLines.join("\n").trim();
    const start_offset =
      bodyStartLine < lines.length ? lines[bodyStartLine].start : lines[hit.lineIdx].end;
    const end_offset =
      bodyEndLine > 0 && bodyEndLine - 1 < lines.length
        ? lines[bodyEndLine - 1].end
        : start_offset + content.length;

    sections.push({
      id: safeRandomId(),
      index: i,
      title: truncate(hit.title, 120) || "Section",
      level: hit.level,
      content,
      char_count: content.length,
      word_count: countWords(content),
      bullet_count: countBullets(content),
      start_offset,
      end_offset,
    });
  }

  const firstHeadingTitle = sections[0]?.title ?? null;
  return {
    document_title: deriveDocumentTitle(normalized, firstHeadingTitle),
    sections,
  };
}
