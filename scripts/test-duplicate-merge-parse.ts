/**
 * Smoke test for duplicate-merge JSON lenient parsing.
 * Run: npx tsx scripts/test-duplicate-merge-parse.ts
 */

import {
  extractBalancedJsonObject,
  parseJsonLenient,
} from "../lib/contacts/duplicate-merge-propose";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const fenced = parseJsonLenient(
  '```json\n{"buckets":[],"unresolved":[{"personId":"a","reason":"x"}]}\n```',
);
assert(
  fenced &&
    typeof fenced === "object" &&
    Array.isArray((fenced as { unresolved: unknown[] }).unresolved) &&
    (fenced as { unresolved: unknown[] }).unresolved.length === 1,
  "fenced JSON should parse",
);

const trailing = parseJsonLenient(
  '{"buckets":[],"unresolved":[{"personId":"a","reason":"x"},],}',
);
assert(trailing && typeof trailing === "object", "trailing commas should parse");

const trunc = parseJsonLenient(
  '{"buckets":[],"unresolved":[{"personId":"a","reason":"no context"},{"personId":"b","reason":"',
);
assert(
  trunc &&
    typeof trunc === "object" &&
    Array.isArray((trunc as { unresolved: unknown[] }).unresolved),
  "truncated JSON should salvage when possible",
);

const balanced = extractBalancedJsonObject('prefix {"a":1,"b":[2]} suffix');
assert(balanced === '{"a":1,"b":[2]}', `balanced extract got ${balanced}`);

console.log("ok: duplicate-merge parse helpers");
