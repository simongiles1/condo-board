# 02 — Drawing Ingestion and Filtering

**Status:** Specification (no implementation yet)  
**Related:** [01 Architecture](./01-architecture-overview.md) · [03 Spatial Model](./03-3d-spatial-model-spec.md) · [04 Temporal Schema](./04-email-parser-and-temporal-schema.md)

---

## 1. Purpose

Convert a large condo drawing set into a **small, high-signal sheet corpus**, then extract equipment schedules into structured JSON that can be joined to spatial nodes (`node_id` / `drawing_tag`).

Stack for this stage:

- **PDF / raster:** PyMuPDF (`fitz`), optional OpenCV for deskew/crop  
- **Vision parse:** OpenAI GPT-4o or Anthropic Claude Vision (batch, pay-per-use)  
- **Output:** `data/schedules/*.json` → merged into `nodes.json` ([04](./04-email-parser-and-temporal-schema.md))

---

## 2. Drawing subset guide

Percentages are **of sheets kept within that discipline**, not of the full set. Target overall keep rate: roughly **10–20% of total sheets**.

### 2.1 Keep / ignore by discipline

| Discipline | Keep target | Keep (examples) | Ignore (examples) |
|---|---|---|---|
| **Architectural (A)** | **10–15%** | Overall building plans, floor plate outlines, roof/penthouse plans, section envelopes, core/shaft locations, mechanical room outlines | Suite layouts, furniture, finishes, door/window schedules, detailed partition types, reflected ceiling plans for suites |
| **Mechanical (M)** | **60–80%** | Equipment schedules (AHU, FCUs serving common areas, chillers, boilers, cooling towers, pumps, fans), mechanical room plans, riser diagrams for major trunks, penthouse equipment plans | Branch duct runs to suites, diffuser schedules, detailed balancing sheets, terminal box callouts for every suite |
| **Electrical (E)** | **30–40%** | Main switchgear / MCC schedules, generator & ATS, transformer schedules, electrical room plans, riser one-lines for feeders serving common equipment | Suite panel schedules, receptacle layouts, lighting fixture schedules for residential units, low-voltage device plans |
| **Plumbing (P)** | **20–30%** | DHW heaters/tanks, booster / jockey pumps, sewage ejectors, domestic water riser diagrams (mains), plumbing equipment schedules, pump room plans | Suite fixture layouts, branch piping, individual fixture connection details, irrigation specialty sheets |

### 2.2 Priority order (build order)

1. **Penthouse / roof mechanical & plumbing equipment** — highest maintenance spend density  
2. **Basement / P1 mechanical, electrical, pump rooms**  
3. **Floor-plate envelopes** (architectural) for spatial context  
4. **Central plant / electrical gear** schedules  
5. **Common-area only** air handlers / exhaust fans  
6. Defer suite-adjacent equipment unless emails already reference it by tag

### 2.3 Sheet selection checklist

For each candidate sheet, keep if **any** of the following is true:

- [ ] Contains an **equipment schedule** table with tags (e.g. `P-1`, `AHU-3`, `EG-1`)  
- [ ] Shows a **mechanical / electrical / pump room** plan with tagged major equipment  
- [ ] Is a **riser / one-line** for building mains (not suite branches)  
- [ ] Is an **architectural floor/roof outline** needed to extrude envelopes in Blender  

Discard if the sheet is primarily:

- Suite plans or interior elevations  
- Branch distribution (duct/pipe/conduit to units)  
- Finish, door, hardware, or millwork schedules  
- Detail callouts at fixture/outlet scale  

### 2.4 Recommended export naming

```
drawings/
  curated/
    A-101_L01_FLOOR_OUTLINE.pdf
    A-401_PH_ROOF_PLAN.pdf
    M-601_EQUIPMENT_SCHEDULE.pdf
    M-201_PH_MECH_PLAN.pdf
    E-601_SWITCHGEAR_SCHEDULE.pdf
    P-601_PUMP_SCHEDULE.pdf
  raster/                  # optional page renders for Vision
    M-601_EQUIPMENT_SCHEDULE_p1.png
```

Use PyMuPDF to render schedule pages at **150–200 DPI** PNG (grayscale acceptable). Higher DPI only if small text fails OCR/vision.

---

## 3. Equipment schedule → JSON extraction

### 3.1 Target schema (per schedule row)

Every extracted row must be mappable to a future or existing spatial node:

```json
{
  "source_sheet": "M-601",
  "source_page": 1,
  "discipline": "mechanical",
  "drawing_tag": "AHU-3",
  "suggested_node_id": "NODE_PH_AHU_03",
  "equipment_type": "air_handling_unit",
  "manufacturer": null,
  "model": null,
  "capacity": { "value": 12000, "unit": "cfm" },
  "location_hint": "Penthouse Mech Room",
  "floor_hint": "PH",
  "service": "Corridor ventilation",
  "notes": [],
  "confidence": 0.86,
  "raw_row_text": "AHU-3 | Penthouse | 12000 CFM | ..."
}
```

Field rules:

| Field | Rule |
|---|---|
| `drawing_tag` | Exact tag from schedule when present; never invent |
| `suggested_node_id` | Follow naming in [03](./03-3d-spatial-model-spec.md); human confirms before `nodes.json` merge |
| `equipment_type` | Snake_case controlled vocabulary (see §3.3) |
| `confidence` | Model self-score 0–1; rows &lt; 0.6 go to review queue |
| `manufacturer` / `model` | `null` if not on sheet—do not hallucinate |

### 3.2 Batch file layout

```
data/schedules/
  M-601_equipment.json      # array of row objects
  P-601_pumps.json
  E-601_switchgear.json
  _review_queue.json        # low-confidence + ambiguous tags
```

### 3.3 Controlled `equipment_type` values (MVP)

```
air_handling_unit, exhaust_fan, supply_fan, chiller, boiler, cooling_tower,
pump_primary, pump_booster, pump_jockey, heat_exchanger, water_heater,
storage_tank, generator, ats, switchgear, transformer, mcc, elevator_machine,
sewage_ejector, other
```

Extend only when a new type appears on a **kept** schedule sheet.

---

## 4. Multimodal Vision API prompting guidelines

### 4.1 When to use Vision vs local OCR

| Case | Approach |
|---|---|
| Clean typed schedule tables | PyMuPDF text extract first; Vision only if columns misalign |
| Scanned / poor PDF text layer | Render PNG → Vision |
| Dense notes / mixed graphics | Crop schedule region (OpenCV or manual) → Vision |
| Single equipment tag callout on plan | Prefer human/Blender placement; Vision optional for tag OCR only |

### 4.2 System prompt (template)

Use this as the stable system message for GPT-4o / Claude Vision:

```text
You extract equipment schedule rows from architectural/engineering drawing images.
Return ONLY valid JSON: an array of objects matching the schema provided by the user.
Rules:
- Copy equipment tags exactly as printed (e.g. P-1, AHU-3). Do not invent tags.
- If a cell is blank or unreadable, use null.
- Do not infer manufacturer or model unless printed.
- Prefer null over guessing.
- Include raw_row_text as the concatenated visible cells for that row.
- Set confidence lower when text is blurry, truncated, or columns are ambiguous.
- Ignore title blocks, general notes, and revision clouds unless they contain schedule cells.
```

### 4.3 User prompt (template)

```text
Discipline: {mechanical|electrical|plumbing}
Sheet id: {e.g. M-601}
Schema:
[
  {
    "source_sheet": string,
    "source_page": number,
    "discipline": string,
    "drawing_tag": string,
    "suggested_node_id": string | null,
    "equipment_type": string,
    "manufacturer": string | null,
    "model": string | null,
    "capacity": { "value": number | null, "unit": string | null } | null,
    "location_hint": string | null,
    "floor_hint": string | null,
    "service": string | null,
    "notes": string[],
    "confidence": number,
    "raw_row_text": string
  }
]

Node id convention if obvious from location:
NODE_<ZONE>_<TYPE>_<NN> where ZONE is PH|B1|B2|L##|ROOF|CORE,
TYPE is short equipment code (PUMP|AHU|EF|GEN|SWGR|DHW|...),
NN is zero-padded index.

Extract every schedule row visible in the image.
```

### 4.4 Prompting practices

1. **One schedule region per call** — crop tables; do not send full 36×48 sheets when avoidable.  
2. **Provide sheet id + discipline** in the user message every time (grounds `source_sheet`).  
3. **Ask for JSON only** — no markdown fences in the response if the API supports raw JSON mode / constrained decoding.  
4. **Validate locally** — schema check with Python (`jsonschema` or hand validation) before merge.  
5. **Never auto-write `nodes.json`** from Vision output; require a confirm step that assigns final `node_id`.  
6. **Retain audit artifacts** — store the PNG crop path and model name/version alongside extraction for re-runs.  
7. **Cost control** — process curated sheets only (§2); cache hashes of page images to skip unchanged pages.

### 4.5 Validation gates before merge to `nodes.json`

- [ ] `drawing_tag` unique within discipline schedule (flag collisions)  
- [ ] `equipment_type` ∈ controlled vocabulary  
- [ ] `suggested_node_id` matches `^NODE_[A-Z0-9]+_[A-Z0-9]+_[0-9]{2}$` or is null  
- [ ] Duplicate `drawing_tag` across sheets reconciled (same asset vs retag)  
- [ ] Human maps `drawing_tag` → final `node_id` and Blender empty ([03](./03-3d-spatial-model-spec.md))

---

## 5. Python ingestion outline (future CLI)

Non-normative sketch for implementers:

```text
extract_schedules.py
  1. Read curated PDF list
  2. For each schedule page:
       a. Try PyMuPDF text table extract
       b. Else render PNG → Vision API
  3. Validate + write data/schedules/<sheet>.json
  4. Append failures to _review_queue.json
```

OpenCV roles (optional): page deskew, table ROI detection, contrast normalization before Vision.

---

## 6. Handoff to spatial & temporal layers

| Output | Consumer |
|---|---|
| Confirmed `drawing_tag` + `node_id` pairs | Blender empties / proxies ([03](./03-3d-spatial-model-spec.md)) |
| Equipment metadata rows | `nodes.json` static fields ([04](./04-email-parser-and-temporal-schema.md)) |
| Location / floor hints | Initial node placement & zone codes |
| Ignored sheet list | Prevents scope creep; keep in `drawings/curated/MANIFEST.md` (future) |

Emails will later match on **`drawing_tag` aliases and plain-language location phrases**; accurate schedule tags here directly improve cost linkage quality in [04](./04-email-parser-and-temporal-schema.md).
