# OKF integration notes (deferred)

**Status:** Reference only — do **not** implement OKF in this repo until extraction /
roster quality work is complete.  
**Last reviewed:** 2026-08-09  
**Audience:** Future agent or human picking up OKF wiring after Condo board
ingestion is solid.

---

## 1. Alignment verdict (current Condo board work)

**Yes — current extraction methodology is conducive to OKF.** It does not need to
emit markdown concepts today. What matters for later OKF is the same substrate
the sibling stack deferred Stage B to get:

| OKF / ADR requirement | Condo board today | Fit |
|---|---|---|
| Quote-grounded claims | `source_quote` on domain extractions + skill facts | ✅ |
| Roster / identity before wiki merge | Contact + org highlight → fingerprint → registry | ✅ |
| Link layer ≠ harvest | Step 2B affiliations (propose / adjudicate / approve) | ✅ |
| Equipment resolve, don’t invent | Building equipment registry + prompt `registry_id` | ✅ |
| Versioned extraction runs | `extraction_sources` (raw JSON, content hash, model, cost) | ✅ |
| Proto–Stage A facts | `discovered_facts` + extraction skill concepts | ✅ partial |
| Three-tier identity (entity / occurrence / observation) | Implicit in domain arrays + registries; not named | ⚠️ map later |
| Opaque entity ID + `okf_path` | Postgres UUIDs / fingerprint keys; no `okf_path` | ⏳ adapter |
| Stage B markdown producer | Not present (correct — deferred) | ⏳ later |
| Ambiguities + fixed-point resolution | Not present | ⏳ later |

**Do not** bolt the mechanical Stage B producer onto current domain tables or
raw concept hints. That path already failed in the pipeline pilot (slug-as-identity
over/under-merge, junk concepts, `misc/` dead end). Keep finishing extraction and
registries here; OKF is an export + wiki layer on top of curated identity.

---

## 2. Sibling repositories (where OKF already lives)

| Repo | Path (local) | OKF role |
|---|---|---|
| **condo-control** | `../condo-control` | Canonical OKF bundle `kb/concepts/`, Stage B producer (`scripts/okf/`), ADRs, knowledge-graph schema, build plan |
| **condo-pipeline** | `../condo-pipeline` | Stage A fact capture → queue; Stage C indexes OKF frontmatter into D1 |
| **condo-insights** | `../condo-insights` | Read-only concept UI; “Curate to OKF” calls control’s producer (local) |

Primary docs to re-read when implementing:

- `condo-control/marshal/adr/001-okf-canonical-knowledge.md` — OKF as canonical; three stages
- `condo-control/marshal/adr/002-insights-board-control-surface.md` — Insights UX; git silent SoR
- `condo-control/marshal/adr/003-graph-identity-and-resolution.md` — three-tier model; why pilot failed
- `condo-control/marshal/adr/004-entity-context-and-extraction-independence.md` — harvest then extract; link at resolution
- `condo-control/kb/AREAS/knowledge-graph-schema.md` — entities / occurrences / observations tables
- `condo-control/kb/AREAS/okf-build-plan.md` — phased plan; Phase 0 froze Stage B
- `condo-pipeline/src/stage-a/capture.ts` + `extraction-types.ts` — Stage A `RawFact` contract
- `condo-control/scripts/okf/producer.ts` — Stage B merge (slug-based; superseded by ADR-003 for identity)

---

## 3. OKF architecture (as designed in siblings)

### 3.1 Three stages

1. **Stage A** — Extract raw facts into D1 (`discovered_facts` / observations), with
   `conceptCategory`, `conceptHint`, `payload`, `sourceQuote`, `confidence`.
2. **Stage B** — Curate into markdown under `condo-control/kb/concepts/…`
   (YAML frontmatter + provenance). Originally queue-driven via `condo-okf-curation`.
3. **Stage C** — Project concept frontmatter into D1 `concept_index` for Insights queries.

### 3.2 Why Stage B was frozen

ADR-003 + build plan Phase 0: identity was wrong before the wiki layer.

- Identity key was `slugify(conceptHint)` → over-merge (2025 vs 2026 jobs) and under-merge (same vendor, different phrasings).
- Weak model pilot produced non-entities and duplicated provenance blocks.
- Categories like `action_item` / `calendar` had no Stage B mapping → `misc/` dead end.
- Decision: stop writing the bundle; fix harvest quality, schema, eval, then backfill.

### 3.3 Three-tier identity (ADR-003) — what OKF actually needs

| Tier | Examples | Canonical store |
|---|---|---|
| **Persistent entity** | person, vendor, equipment, unit, project | OKF markdown under `kb/concepts/` (narrowed scope) |
| **Bounded occurrence** | maintenance job, meeting, action_item, invoice, campaign | Typed DB rows; identity = subject entity + type + time window |
| **Immutable observation** | what one email asserted | Never merged; tied to source document |

Linking (`target_entity_id`, affiliations, email tenure) happens at a **resolution /
link layer**, not by injecting the full phonebook into every extract prompt
(ADR-004: per-email mentions + small core roster only).

---

## 4. Condo board surfaces that map cleanly later

These are the assets an OKF adapter should consume first:

| Board artifact | Maps toward |
|---|---|
| `contact_persons` + emails / titles | Person **entities** (+ temporal email assignments) |
| `organization_entities` / org fingerprints | Vendor / org **entities** |
| `person_organization_affiliations` | Edges / `fields_json.organization_entity_id` (link layer) |
| `building_equipment_registry` | Equipment **entities** (resolve-only; never create from loose mentions) |
| Domain extractions with `source_quote` | **Observations** (and occurrence proposals when dated/bounded) |
| `extraction_sources` + superseding runs | Versioned extraction; prefer supersede over duplicate |
| `discovered_facts` + skill entries | Dynamic concepts → either entity fields or observation payloads |

Typed destination tables (`vendors`, `maintenance_events`, `extracted_action_items`,
calendar, etc.) are useful product UX today. For OKF, treat them as **views or
staging**, not the long-term identity key — ADR-001 demoted per-email tables as
canonical; ADR-003 puts occurrences in typed rows with proper keys.

---

## 5. Stage A fact contract (adapter target)

Pipeline Stage A shape (`condo-pipeline/src/stage-a/extraction-types.ts`):

```ts
type RawFact = {
  conceptCategory: string; // equipment|vendor|person|project|issue|unit|meeting|…
  conceptHint?: string;
  payload: Record<string, unknown>;
  sourceQuote?: string;
  confidence?: string; // high|medium|low
};
```

When wiring Condo board → OKF path, prefer an **adapter** that:

1. Classifies each board extraction into **entity | occurrence | observation**.
2. Emits Stage A–compatible facts (or writes observations directly) with
   grounded quotes.
3. Attaches registry IDs when known; leaves entity links null when not (deferred resolution).
4. **Does not** call `slugify(hint)` as identity for merge.

---

## 6. Recommended future integration sequence

Do **not** start this until extraction / roster work here is done.

1. **Finish identity quality in Condo board** — people, orgs, equipment, affiliations; quote grounding; eval as needed.
2. **Publish an adapter contract** — board outputs → tier + `RawFact` / observation row (+ `sourceEmailId`).
3. **Seed OKF from curated registries** — export approved people / vendors / equipment → `kb/concepts/…` with **opaque IDs** and `okf_path` as presentation, not identity.
4. **Keep occurrences in DB** — maintenance, meetings, action items, invoices keyed by subject + type + period; OKF links to entities, does not name-merge occurrences.
5. **Stage B only for entity enrichment** — append provenance / fields onto existing concepts; Insights (or board) as human surface; git remains silent SoR (ADR-002).
6. **Ambiguity queue + fixed-point resolver** — only after a measured backfill residue exists (build plan Phase 5).

```text
Highlight harvest → Fingerprints / registries → Link layer
        ↓
Typed extractions + quotes → Observations
        ↓
Curated entities (+ okf_path) → Stage B markdown (entities only)
        ↓
Occurrences stay in DB ← observations / dated extractions
```

---

## 7. Guardrails while finishing extraction (stay OKF-conducive)

When changing prompts or schemas in this repo, check:

1. **Tier** — Is this an entity, occurrence, or observation? If unclear, prefer observation + quote.
2. **Quote** — Does every claim have a verbatim `source_quote` that can be string-matched in the source?
3. **Slug hazard** — Would mechanical Stage B merge this by free-text name incorrectly? If yes, it needs subject + time window (occurrence), not a concept file.
4. **Registry first** — Especially equipment: resolve against registry; do not invent durable assets from bid options / components.
5. **Link deferred** — Affiliations, org membership, email↔person tenure belong at the link layer (propose / curate), not forced inside every extract call.
6. **Round-trip** — Could this emit Stage A `RawFact` shape without losing provenance? If not, you may be locking into board-only tables — document the mapping debt.

**Anti-patterns to avoid until OKF work starts (and then still avoid):**

- Writing markdown concepts from uncurated hints
- Using filename / slug as the only identity
- Merging 2025 and 2026 jobs because they share an equipment name
- Dumping the full contact phonebook into every LLM extract prompt
- Treating calendar/action product tables as the final graph identity model

---

## 8. Explicit non-goals for now

- No OKF producer, queue, or `kb/concepts` tree in Condo board.
- No requirement that every extract field already use OKF `type` strings.
- No migration of Postgres destination tables to D1 / Workers until a dedicated work order.
- Condo board may remain the extraction quality lab / reference UX even after Insights owns board-facing curation (ADR-001/002 historically called board “reference”; this repo is actively improving ingestion first).

---

## 9. Quick pointer index (this repo)

| Area | Location |
|---|---|
| Domain extraction schema | `lib/email-analysis/schema.ts` |
| Extract prompts | `lib/email-analysis/prompts.ts` |
| Persist to tables + skill facts | `lib/email-analysis/persist.ts`, `extraction-skill.ts` |
| Contact / org highlight + fingerprints | `lib/email-analysis/contact-highlight-*.ts`, `org-highlight-*.ts` |
| Registries / affiliations | `lib/db/schema.ts` (`contact_persons`, `organization_entities`, `person_organization_affiliations`, `building_equipment_registry`, `discovered_facts`, `extraction_sources`) |
| Product history of extraction phases | `CHANGELOG.md` |

---

## 10. One-line reminder

**Finish registries and quote-grounded extractions here; OKF later is an adapter + curated entity wiki, not a rewrite of every extract field into markdown.**
