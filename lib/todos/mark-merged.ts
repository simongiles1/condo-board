const MERGED_SUFFIX = " (merged to global)";
const MERGED_SUFFIX_RE = /\s*\(merged to global\)\s*$/i;

const UNCHECKED_ITEM = /^(-\s*\[\s?\]\s+)(.+)$/;
const CHECKED_ITEM = /^(-\s*\[\s?[xX]\s?\]\s+)(.+)$/;

/** Mark every open meeting todo as checked and labelled after a global merge. */
export function markMeetingTodosMerged(markdown: string): string {
  const lines = markdown.split(/\r?\n/);

  return lines
    .map((raw) => {
      const line = raw.trimEnd();
      const trimmed = line.trim();
      if (!trimmed) return raw;

      const unchecked = UNCHECKED_ITEM.exec(trimmed);
      if (unchecked) {
        const desc = appendMergedSuffix(unchecked[2].trim());
        return `- [x] ${desc}`;
      }

      const checked = CHECKED_ITEM.exec(trimmed);
      if (checked) {
        const desc = appendMergedSuffix(checked[2].trim());
        return `- [x] ${desc}`;
      }

      return raw;
    })
    .join("\n");
}

function appendMergedSuffix(description: string): string {
  if (MERGED_SUFFIX_RE.test(description)) {
    return description.replace(MERGED_SUFFIX_RE, MERGED_SUFFIX);
  }
  return `${description}${MERGED_SUFFIX}`;
}

export function isMergedTodoDescription(description: string): boolean {
  return MERGED_SUFFIX_RE.test(description.trim());
}

export { MERGED_SUFFIX };
