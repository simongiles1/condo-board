import type {
  BudgetAmountRole,
  BudgetLineItem,
  ExtractedBudgetAmount,
  ExtractedBudgetLine,
  ParsedBudgetMarkdown,
} from "@/lib/budget/types";

const GL_CODE_RE = /^(\d{4})\b/;
const FISCAL_RANGE_RE = /(\d{4})\s*[-–]\s*(\d{4})/;

type AmountColumn = {
  index: number;
  fiscalYearStart: number;
  role: BudgetAmountRole;
};

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;/g, "'")
    .trim();
}

function isMarkdownSeparatorRow(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return false;
  const inner = trimmed.replace(/\|/g, "").replace(/[:\s-]/g, "");
  return inner.length === 0 && trimmed.includes("-");
}

function splitPipeRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || isMarkdownSeparatorRow(trimmed)) return null;
  return trimmed
    .split("|")
    .slice(1, -1)
    .map((cell) => decodeEntities(cell.replace(/_/g, " ")).replace(/\s+/g, " "));
}

export function parseAmountCell(raw: string): number | null {
  const text = decodeEntities(raw).replace(/_/g, "").trim();
  if (!text || text === "-") return null;
  if (/[A-Za-z]{3,}/.test(text)) return null;
  const match = text.match(/^\(?-?[\d,]+(?:\.\d+)?\)?$/);
  if (!match) return null;
  const parenNeg = /^\(.*\)$/.test(text);
  const value = Number(text.replace(/[(),]/g, ""));
  if (!Number.isFinite(value)) return null;
  return parenNeg ? -Math.abs(value) : value;
}

function parseTrailingAmounts(text: string): { name: string; amounts: number[] } {
  const tokens = text.trim().split(/\s+/);
  const amounts: number[] = [];
  while (tokens.length > 0) {
    const parsed = parseAmountCell(tokens[tokens.length - 1] ?? "");
    if (parsed == null) break;
    amounts.unshift(parsed);
    tokens.pop();
  }
  return { name: tokens.join(" ").trim(), amounts };
}

export function categoryFromGlCode(code: string, section: string | null): string {
  const n = Number(code);
  if (n >= 4000 && n < 5000) return "Revenue";
  if (n >= 5500 && n < 6000) return "Administration";
  if (n >= 6000 && n < 6100) return "Utilities";
  if (n >= 6100 && n < 6400) return "Contracts";
  if (n >= 6400 && n < 8500) return "Repairs and maintenance";
  if (n >= 8500) return "Reserve fund";
  return section ?? "Other";
}

function sectionFromHeaderText(text: string): string | null {
  const normalized = text.replace(/\s+/g, " ").trim().toUpperCase();
  if (!normalized || normalized === "DESCRIPTION") return null;
  if (normalized.includes("ADMINISTRATION")) return "Administration";
  if (normalized.includes("UTILITIES")) return "Utilities";
  if (normalized.includes("CONTRACT")) return "Contracts";
  if (normalized.includes("REPAIR")) return "Repairs and maintenance";
  if (normalized.includes("RESERVE")) return "Reserve fund";
  if (normalized.includes("REVENUE") || normalized.includes("OPERATING INCOME")) {
    return "Revenue";
  }
  return null;
}

function headerRole(text: string): BudgetAmountRole | "change" | null {
  const upper = text.toUpperCase();
  if (upper.includes("CHANGE") || upper.includes("%")) return "change";
  if (upper.includes("PROJECTED")) return "projected";
  if (upper.includes("BUDGET")) return "budget";
  return null;
}

function fiscalYearStartFromText(text: string): number | null {
  const match = text.match(FISCAL_RANGE_RE);
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (end !== start + 1) return null;
  return start;
}

function isHeaderContinuationRow(cells: string[]): boolean {
  const joined = cells.join(" ").toUpperCase();
  if (GL_CODE_RE.test(cells.find((cell) => cell.trim()) ?? "")) return false;
  return (
    joined.includes("BUDGET") ||
    joined.includes("PROJECTED") ||
    joined.includes("CHANGE") ||
    joined.includes("DESCRIPTION")
  );
}

function columnsFromHeaderRows(rows: string[][]): AmountColumn[] {
  if (!rows.length) return [];
  const width = Math.max(...rows.map((row) => row.length));
  const columns: AmountColumn[] = [];

  for (let index = 0; index < width; index += 1) {
    const combined = rows
      .map((row) => row[index] ?? "")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    const yearStart = fiscalYearStartFromText(combined);
    const role = headerRole(combined);
    if (yearStart == null || role == null || role === "change") continue;
    columns.push({ index, fiscalYearStart: yearStart, role });
  }

  return columns;
}

function collectMarkdownTables(markdown: string): string[][][] {
  const lines = markdown.split(/\r?\n/);
  const tables: string[][][] = [];
  let current: string[][] = [];

  const flush = () => {
    if (current.length >= 2) tables.push(current);
    current = [];
  };

  for (const line of lines) {
    if (isMarkdownSeparatorRow(line)) continue;
    const cells = splitPipeRow(line);
    if (!cells) {
      flush();
      continue;
    }
    current.push(cells);
  }
  flush();
  return tables;
}

function zipAmounts(
  values: number[],
  columns: AmountColumn[],
): ExtractedBudgetAmount[] {
  const amounts: ExtractedBudgetAmount[] = [];
  const count = Math.min(values.length, columns.length);
  for (let index = 0; index < count; index += 1) {
    const column = columns[index];
    const value = values[index];
    if (!column || value == null) continue;
    amounts.push({
      fiscalYearStart: column.fiscalYearStart,
      role: column.role,
      value,
    });
  }
  return amounts;
}

function parseGlRow(
  cells: string[],
  columns: AmountColumn[],
  section: string | null,
): ExtractedBudgetLine | null {
  const firstNonEmptyIndex = cells.findIndex((cell) => cell.trim());
  if (firstNonEmptyIndex < 0) return null;

  const first = cells[firstNonEmptyIndex] ?? "";
  const glMatch = first.match(GL_CODE_RE);
  if (!glMatch) return null;

  const code = glMatch[1];
  const remainder = first.slice(glMatch[0].length).trim();
  const laterCells = cells.slice(firstNonEmptyIndex + 1);
  const laterHaveAmounts = laterCells.some((cell) => parseAmountCell(cell) != null);

  let name: string;
  let values: number[];

  if (remainder && !laterHaveAmounts) {
    const trailing = parseTrailingAmounts(remainder);
    name = trailing.name;
    values = trailing.amounts;
  } else {
    const nameParts: string[] = [];
    values = [];
    if (remainder) {
      const trailing = parseTrailingAmounts(remainder);
      if (trailing.name) nameParts.push(trailing.name);
      values.push(...trailing.amounts);
    }
    for (const cell of laterCells) {
      const parsed = parseAmountCell(cell);
      if (parsed != null) values.push(parsed);
      else if (cell.trim() && values.length === 0) nameParts.push(cell.trim());
    }
    name = nameParts.join(" ");
  }

  name = name.replace(/\s+/g, " ").replace(/[-–]+$/, "").trim();
  if (!name || /^TOTAL\b/i.test(name)) return null;

  return {
    code,
    name,
    category: categoryFromGlCode(code, section),
    amounts: zipAmounts(values, columns),
  };
}

function mergeLines(lines: ExtractedBudgetLine[]): ExtractedBudgetLine[] {
  const byCode = new Map<string, ExtractedBudgetLine>();
  for (const line of lines) {
    const existing = byCode.get(line.code);
    if (!existing) {
      byCode.set(line.code, {
        ...line,
        amounts: [...line.amounts],
      });
      continue;
    }
    if (line.name.length > existing.name.length) existing.name = line.name;
    if (line.category && existing.category === "Other") {
      existing.category = line.category;
    }
    for (const amount of line.amounts) {
      const already = existing.amounts.find(
        (item) =>
          item.fiscalYearStart === amount.fiscalYearStart &&
          item.role === amount.role,
      );
      if (!already) existing.amounts.push(amount);
    }
  }
  return [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
}

export function parseBudgetMarkdown(markdown: string): ParsedBudgetMarkdown {
  const tables = collectMarkdownTables(markdown);
  const lines: ExtractedBudgetLine[] = [];
  let section: string | null = null;

  for (const table of tables) {
    let headerEnd = 0;
    while (headerEnd < table.length && isHeaderContinuationRow(table[headerEnd] ?? [])) {
      headerEnd += 1;
    }
    if (headerEnd === 0) headerEnd = 1;

    const columns = columnsFromHeaderRows(table.slice(0, headerEnd));
    if (!columns.length) continue;

    for (const cells of table.slice(headerEnd)) {
      const headerText = cells.join(" ");
      const nextSection = sectionFromHeaderText(headerText);
      const hasGl = cells.some((cell) => GL_CODE_RE.test(cell.trim()));
      if (nextSection && !hasGl) {
        section = nextSection;
        continue;
      }
      if (/^\s*TOTAL\b/i.test(cells.find((cell) => cell.trim()) ?? "")) continue;

      const parsed = parseGlRow(cells, columns, section);
      if (parsed) lines.push(parsed);
    }
  }

  return { lines: mergeLines(lines) };
}

export type RankedBudgetParse = {
  rank: number;
  receivedAt: string;
  parsed: ParsedBudgetMarkdown;
};

/**
 * Merge figures across packages. A later package's "prior year projected"
 * column is the best available actual for that prior year. Final documents
 * beat drafts for the same field.
 */
export function mergeParsedBudgetDocuments(
  documents: RankedBudgetParse[],
): ExtractedBudgetLine[] {
  type FieldKey = `${string}:${number}:${BudgetAmountRole}`;
  const fieldRank = new Map<FieldKey, { rank: number; receivedAt: string; value: number }>();
  const names = new Map<
    string,
    { rank: number; receivedAt: string; name: string; category: string }
  >();

  const ranked = [...documents].sort((a, b) => {
    if (b.rank !== a.rank) return b.rank - a.rank;
    return b.receivedAt.localeCompare(a.receivedAt);
  });

  for (const document of ranked) {
    for (const line of document.parsed.lines) {
      const currentName = names.get(line.code);
      if (
        !currentName ||
        document.rank > currentName.rank ||
        (document.rank === currentName.rank &&
          document.receivedAt > currentName.receivedAt)
      ) {
        names.set(line.code, {
          rank: document.rank,
          receivedAt: document.receivedAt,
          name: line.name,
          category: line.category,
        });
      }

      for (const amount of line.amounts) {
        const key: FieldKey = `${line.code}:${amount.fiscalYearStart}:${amount.role}`;
        const existing = fieldRank.get(key);
        if (
          !existing ||
          document.rank > existing.rank ||
          (document.rank === existing.rank &&
            document.receivedAt > existing.receivedAt)
        ) {
          fieldRank.set(key, {
            rank: document.rank,
            receivedAt: document.receivedAt,
            value: amount.value,
          });
        }
      }
    }
  }

  const byCode = new Map<string, ExtractedBudgetLine>();
  for (const [key, field] of fieldRank) {
    const [code, yearStr, role] = key.split(":") as [string, string, BudgetAmountRole];
    const meta = names.get(code);
    if (!meta) continue;
    const line = byCode.get(code) ?? {
      code,
      name: meta.name,
      category: meta.category,
      amounts: [],
    };
    line.amounts.push({
      fiscalYearStart: Number(yearStr),
      role,
      value: field.value,
    });
    byCode.set(code, line);
  }

  return [...byCode.values()]
    .map((line) => ({
      ...line,
      amounts: line.amounts.sort(
        (a, b) =>
          a.fiscalYearStart - b.fiscalYearStart || a.role.localeCompare(b.role),
      ),
    }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

export function toBudgetLineItems(
  extracted: ExtractedBudgetLine[],
): BudgetLineItem[] {
  return extracted.map((line) => {
    const byYear: Record<number, { budgeted: number | null; actual: number | null }> =
      {};
    for (const amount of line.amounts) {
      const current = byYear[amount.fiscalYearStart] ?? {
        budgeted: null,
        actual: null,
      };
      if (amount.role === "budget") current.budgeted = amount.value;
      else current.actual = amount.value;
      byYear[amount.fiscalYearStart] = current;
    }
    return {
      code: line.code,
      name: line.name,
      category: line.category,
      byYear,
    };
  });
}
