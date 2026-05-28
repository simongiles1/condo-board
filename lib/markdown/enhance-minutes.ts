/** Standalone ALL-CAPS lines become markdown headings for readable preview. */
export function enhanceMinutesMarkdown(markdown: string): string {
  return markdown
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("**")) {
        return line;
      }

      const isAllCapsHeading =
        trimmed.length >= 4 &&
        /[A-Z]/.test(trimmed) &&
        trimmed === trimmed.toUpperCase() &&
        /^[A-Z0-9\s/\-–—.:()]+$/.test(trimmed);

      if (isAllCapsHeading) {
        return `## ${trimmed}`;
      }

      return line;
    })
    .join("\n");
}
