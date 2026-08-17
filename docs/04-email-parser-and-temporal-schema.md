# 04 — Email Parser and Temporal Schema

**Status:** Specification (no implementation yet)  
**Related:** [01 Architecture](./01-architecture-overview.md) · [02 Drawing Ingestion](./02-drawing-ingestion-and-filtering.md) · [03 Spatial Model](./03-3d-spatial-model-spec.md) · [05 Three.js Frontend](./05-threejs-frontend-spec.md)

---

## 1. Purpose

Bridge **static spatial nodes** (permanent 3D anchors) with **dynamic temporal records** (maintenance, repairs, replacements, invoices referenced in email).

Stack:

- Python 3.11+  
- `extract_msg` (Outlook MSG), stdlib / existing tools for EML; PST via local extraction to MSG/EML before parse  
- `pandas` for time-series aggregation per `node_id`  
- Regex + keyword dictionaries first; optional semantic assist only for unresolved rows  

Outputs consumed by the Three.js viewer ([05](./05-threejs-frontend-spec.md)):

- `data/nodes.json` — static ledger  
- `data/financials.json` — temporal ledger  

---

## 2. Core identity model

```
Spatial node (permanent)          Asset instance (time-bounded)
─────────────────────────         ─────────────────────────────
node_id: NODE_PH_PUMP_01          asset_id: ASSET_2024_PUMP_A
drawing_tag: P-1                  installed_at / removed_at
world position in GLB             manufacturer / model / serial
                                  events[] → costs, work orders
```

Rules:

1. **`node_id` never changes** when equipment is replaced.  
2. A node has **zero or one current asset** and zero or more historical assets.  
3. Every cost event attaches to **`node_id`** (required) and optionally `asset_id`.  
4. Email matching may hit `drawing_tag`, aliases, or location phrases; resolver maps them to `node_id`.

---

## 3. Schema: `nodes.json`

Top-level object:

```json
{
  "version": 1,
  "building_id": "condo_main",
  "updated_at": "2026-08-10T12:00:00Z",
  "nodes": [
    {
      "node_id": "NODE_PH_PUMP_01",
      "drawing_tag": "P-1",
      "aliases": ["P1", "penthouse booster", "PH booster pump"],
      "discipline": "plumbing",
      "equipment_type": "pump_booster",
      "zone": "PH",
      "label": "Penthouse domestic booster pump 1",
      "status": "active",
      "glb_object_name": "NODE_PH_PUMP_01",
      "proxy_object_name": "PROXY_PH_PUMP_01",
      "schedule_ref": {
        "source_sheet": "P-601",
        "capacity": { "value": 150, "unit": "gpm" }
      },
      "current_asset_id": "ASSET_2019_PUMP_01",
      "assets": [
        {
          "asset_id": "ASSET_2019_PUMP_01",
          "installed_at": "2019-04-12",
          "removed_at": null,
          "manufacturer": "Acme Pumps",
          "model": "B-200",
          "serial": null,
          "notes": "Original install per board records"
        }
      ]
    }
  ]
}
```

### 3.1 Field reference (`nodes[]`)

| Field | Type | Required | Notes |
|---|---|---|---|
| `node_id` | string | yes | Matches Blender / GLB name ([03](./03-3d-spatial-model-spec.md)) |
| `drawing_tag` | string \| null | no | Primary schedule tag |
| `aliases` | string[] | no | Extra match strings for email parser (lowercase normalize at match time) |
| `discipline` | string | yes | `architectural` \| `mechanical` \| `electrical` \| `plumbing` |
| `equipment_type` | string | yes | Controlled vocab from [02](./02-drawing-ingestion-and-filtering.md) |
| `zone` | string | yes | `PH`, `B1`, `L01`, … |
| `label` | string | yes | Human-readable |
| `status` | string | yes | `active` \| `inactive` \| `decommissioned` |
| `glb_object_name` | string | yes | Usually equals `node_id` |
| `proxy_object_name` | string \| null | no | Heatmap target mesh if present |
| `schedule_ref` | object \| null | no | Snapshot from schedule extraction |
| `current_asset_id` | string \| null | no | Must exist in `assets` when set |
| `assets` | array | yes | May be empty initially |

### 3.2 Asset replacement pattern

When pump `ASSET_2019_PUMP_01` is replaced:

1. Set `removed_at` on the old asset.  
2. Append new asset with new `asset_id` and `installed_at`.  
3. Set `current_asset_id` to the new asset.  
4. Add a `replacement` event in `financials.json` linked to the same `node_id`.  
5. **Do not** rename the spatial node or GLB empty.

---

## 4. Schema: `financials.json`

```json
{
  "version": 1,
  "currency": "CAD",
  "updated_at": "2026-08-10T12:00:00Z",
  "thresholds": {
    "trailing_months": 12,
    "green_max": 2000,
    "yellow_max": 8000
  },
  "events": [
    {
      "event_id": "evt_2023_08_14_001",
      "node_id": "NODE_PH_PUMP_01",
      "asset_id": "ASSET_2019_PUMP_01",
      "event_type": "repair",
      "event_date": "2023-08-14",
      "amount": 4250.00,
      "currency": "CAD",
      "vendor": "Harbor Mechanical",
      "summary": "Replace mechanical seal and realign coupling",
      "source": {
        "kind": "email",
        "message_id": "<abc@example.com>",
        "subject": "RE: PH booster pump leak",
        "path": "mail/export/2023/08/msg_123.eml"
      },
      "match": {
        "method": "regex_tag",
        "matched_text": "P-1",
        "confidence": 0.92
      },
      "tags": ["seal", "leak"]
    }
  ],
  "aggregates": [
    {
      "node_id": "NODE_PH_PUMP_01",
      "window": "trailing_12m",
      "as_of": "2026-08-10",
      "event_count": 3,
      "total_amount": 9120.00,
      "heatmap_band": "yellow"
    }
  ]
}
```

### 4.1 `event_type` values

```
inspection, repair, maintenance, replacement, invoice, quote,
emergency, other
```

### 4.2 `thresholds` → heatmap bands

Used by the viewer ([05](./05-threejs-frontend-spec.md)):

| Condition on `total_amount` in window | `heatmap_band` | Color intent |
|---|---|---|
| `<= green_max` | `green` | Healthy / low spend |
| `> green_max` and `<= yellow_max` | `yellow` | Elevated |
| `> yellow_max` | `red` | High spend / attention |

`aggregates[]` is precomputed by Pandas so the browser does not re-sum large event lists on every load (it may still filter client-side for custom ranges later).

### 4.3 Field reference (`events[]`)

| Field | Type | Required | Notes |
|---|---|---|---|
| `event_id` | string | yes | Stable unique id |
| `node_id` | string | yes | Must exist in `nodes.json` (or quarantine file) |
| `asset_id` | string \| null | no | When known |
| `event_type` | string | yes | Controlled vocab |
| `event_date` | string (YYYY-MM-DD) | yes | Best-effort from email date |
| `amount` | number \| null | no | Null if mention without $ |
| `currency` | string | yes | Default from file top-level |
| `vendor` | string \| null | no | |
| `summary` | string | yes | Short normalized text |
| `source` | object | yes | Provenance for audit |
| `match` | object | yes | How `node_id` was resolved |
| `tags` | string[] | no | Extra keywords |

---

## 5. Email parsing logic

### 5.1 Ingestion order

```
PST (optional) → export MSG/EML
      ↓
parse metadata (date, subject, from, body text, attachments names)
      ↓
normalize text (lowercase, collapse whitespace)
      ↓
detect currency amounts
      ↓
match node candidates (tags → aliases → location phrases)
      ↓
score + accept / review
      ↓
append financials.events (+ quarantine unresolved)
      ↓
pandas aggregate → financials.aggregates
```

### 5.2 Amount detection (regex examples)

Implementations should treat these as starting patterns (tune per locale):

```text
\$\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?
(?:CAD|USD)\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?
(?:invoice|quote|cost|spent|amount|total)\D{0,20}\$?\d[\d,]*\.?\d{0,2}
```

Rules:

- Prefer amounts near maintenance keywords (`repair`, `replace`, `invoice`, `WO`, `work order`).  
- Ignore obvious non-cost numbers (phone, addresses, unit numbers) via negative context.  
- If multiple amounts, take the one closest to vendor/invoice language; else flag for review.

### 5.3 Node matching priority

| Priority | Method | Example |
|---|---|---|
| 1 | Exact `drawing_tag` token | `\bP-1\b`, `\bAHU-3\b` |
| 2 | Normalized tag variants | `P1`, `P 1`, `AHU3` |
| 3 | `aliases[]` phrase match | `penthouse booster` |
| 4 | Zone + type keywords | `PH` + `booster pump` → candidates in zone `PH` |
| 5 | Attachment / subject only weak hints | Lower confidence; usually review |

On ambiguity (2+ nodes above confidence floor), write to `data/financials_review.json` instead of auto-assigning.

### 5.4 Suggested keyword packs

```text
maintenance: repair, replaced, leak, seized, bearing, seal, PM, inspection,
             breakdown, outage, temporary pump, after hours
electrical:  generator, ATS, transfer switch, switchgear, MCC, transformer
mechanical:  AHU, chiller, condenser, cooling tower, make-up air
plumbing:    booster, jockey, DHW, domestic water, ejector, sump
```

Combine with node-specific aliases from `nodes.json` rather than hard-coding every asset into the parser.

### 5.5 Python module sketch (future)

```text
tools/parse_emails.py
  --mail-root ./mail/export
  --nodes ./data/nodes.json
  --out ./data/financials.json
  --review ./data/financials_review.json

tools/aggregate_costs.py
  --financials ./data/financials.json
  --thresholds trailing_months=12 green_max=2000 yellow_max=8000
```

Pandas responsibilities:

- Filter `events` by `event_date` window  
- `groupby(node_id).agg(total_amount, event_count)`  
- Map totals → `heatmap_band`  
- Write `aggregates[]` back into `financials.json`

---

## 6. Quarantine & quality

| Issue | Destination |
|---|---|
| No node match | `financials_review.json` |
| Ambiguous multi-node match | `financials_review.json` |
| Amount parse failed but maintenance language present | review with `amount: null` candidate |
| Matched node but `status: decommissioned` | allow event; flag warning |

Never drop source provenance; re-runs should be idempotent via `event_id` or `(message_id, node_id, amount, event_date)` dedupe key.

---

## 7. Viewer consumption contract

The Three.js app ([05](./05-threejs-frontend-spec.md)) will:

1. Load `nodes.json` + `financials.json` alongside `building.glb`.  
2. Index `aggregates` by `node_id` for heatmap colors.  
3. On node pick, filter `events` where `event_id`/`node_id` match and show chronological history.  
4. Display `current_asset_id` metadata from `nodes.json` in the popup header.

Optional future enhancement: compute aggregates client-side for custom date ranges; MVP trusts precomputed `aggregates`.

---

## 8. Alignment checklist

- [ ] Every `glb_object_name` exists in `building.glb`  
- [ ] Every `financials.events[].node_id` exists in `nodes.json` (or review file)  
- [ ] `drawing_tag` / `aliases` cover tags used on curated schedules ([02](./02-drawing-ingestion-and-filtering.md))  
- [ ] Replacement events do not create new spatial nodes ([03](./03-3d-spatial-model-spec.md))  
- [ ] `thresholds` in `financials.json` match colors documented in [05](./05-threejs-frontend-spec.md)
