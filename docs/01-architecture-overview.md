# 01 — Architecture Overview

**Status:** Specification (no implementation yet)  
**Audience:** Implementers building the lightweight 3D building digital twin  
**Related:** [02 Drawing Ingestion](./02-drawing-ingestion-and-filtering.md) · [03 Spatial Model](./03-3d-spatial-model-spec.md) · [04 Email / Temporal Schema](./04-email-parser-and-temporal-schema.md) · [05 Three.js Frontend](./05-threejs-frontend-spec.md)

---

## 1. Executive summary

This system is a **local-first digital twin** for a residential high-rise condo. It binds three concerns to a shared spatial coordinate system:

| Layer | Role | Primary tools |
|---|---|---|
| **Spatial** | Permanent 3D anchors (“spatial nodes”) for major equipment & building envelopes | Blender → GLTF/GLB → Three.js |
| **Static metadata** | Equipment tags, schedules, capacities from M/E/P drawings | PyMuPDF / OpenCV + GPT-4o / Claude Vision → JSON |
| **Temporal / cost** | Maintenance events, replacements, and spend over time | Python (`extract_msg`, Pandas) → `financials.json` |

The twin is intentionally **lightweight**: extruded floor envelopes and bounding-box equipment proxies—not BIM, not IFC, not photoreal geometry. The goal is decision support (where is it, what did it cost, how often does it fail), not construction documentation.

---

## 2. Design principles

1. **Zero subscription cost for core runtime** — Viewer runs as static HTML/JS served locally. Email parsing and schedule extraction run on a local Python environment. Multimodal LLM calls are optional, batch, and pay-per-use only during ingestion—not required for day-to-day viewing.
2. **Local execution** — Drawing PDFs, PST/EML archives, GLB models, and JSON ledgers stay on disk. No mandatory cloud database.
3. **Low computational overhead** — Single GLB scene, client-side Three.js WebGL, pre-aggregated cost metrics in JSON. No server-side rendering, no real-time physics, no continuous LLM inference.
4. **Stable spatial IDs** — Geometry may be refined; **node IDs never change**. Temporal records attach to nodes by ID, not by mesh name.
5. **Selective fidelity** — Only equipment and envelopes that appear in maintenance/cost history are modeled. Suite interiors and branch distribution are out of scope (see [02](./02-drawing-ingestion-and-filtering.md)).

---

## 3. End-to-end data pipeline

```
┌─────────────────────┐     ┌──────────────────────┐     ┌─────────────────────┐
│ Architectural /     │     │ Blender              │     │ GLTF/GLB scene      │
│ M/E/P PDF drawings  │────▶│ Extrude envelopes    │────▶│ + empties / proxies │
│ (filtered subset)   │     │ Place spatial nodes  │     │ (web-optimized)     │
└─────────┬───────────┘     └──────────────────────┘     └──────────┬──────────┘
          │                                                          │
          │ Vision / OCR schedule parse                              │
          ▼                                                          ▼
┌─────────────────────┐                                   ┌─────────────────────┐
│ schedules/*.json    │──────────────────────────────────▶│ nodes.json          │
│ (equipment metadata)│   merge tag ↔ NODE_* mapping      │ (static ledger)     │
└─────────────────────┘                                   └──────────┬──────────┘
                                                                     │
┌─────────────────────┐     ┌──────────────────────┐                 │
│ PST / EML / MSG     │────▶│ Python email parser  │─────────────────┤
│ archives (local)    │     │ regex + keyword tags │                 │
└─────────────────────┘     │ Pandas aggregation   │                 │
                            └──────────┬───────────┘                 │
                                       ▼                             ▼
                            ┌──────────────────────┐     ┌─────────────────────┐
                            │ financials.json      │────▶│ Three.js viewer     │
                            │ (temporal ledger)    │     │ GLB + heatmaps      │
                            └──────────────────────┘     │ raycast tooltips    │
                                                         └─────────────────────┘
```

### Pipeline stages (ordered)

| Stage | Input | Output | Spec |
|---|---|---|---|
| **A. Drawing filter** | Full drawing set PDF | Curated sheet list (A / M / E / P %) | [02](./02-drawing-ingestion-and-filtering.md) |
| **B. Schedule extract** | Schedule sheets (PDF/PNG) | Structured equipment JSON | [02](./02-drawing-ingestion-and-filtering.md) |
| **C. Spatial model** | Floor plan traces + node list | `building.glb` + node empties | [03](./03-3d-spatial-model-spec.md) |
| **D. Node ledger** | Schedule JSON + Blender node IDs | `nodes.json` | [04](./04-email-parser-and-temporal-schema.md) |
| **E. Email / cost parse** | Local mail archives | `financials.json` | [04](./04-email-parser-and-temporal-schema.md) |
| **F. Visualization** | GLB + both JSON ledgers | Interactive heatmap viewer | [05](./05-threejs-frontend-spec.md) |

Canonical join key across all stages: **`node_id`** (e.g. `NODE_PH_PUMP_01`), with optional drawing tag aliases (e.g. `P-1`).

---

## 4. Runtime topology (target)

```
/digital-twin/                 # future implementation root (not created yet)
  /assets/
    building.glb               # Blender export
    /textures/                 # optional, keep minimal
  /data/
    nodes.json                 # static spatial + equipment metadata
    financials.json            # temporal cost / maintenance events
    /schedules/                # raw Vision extraction outputs (audit)
  /viewer/
    index.html
    main.js                    # Three.js scene, raycast, heatmap
    styles.css
  /tools/                      # Python CLIs (ingestion only)
    extract_schedules.py
    parse_emails.py
    aggregate_costs.py
```

**Viewer runtime:** open `viewer/index.html` via a local static server (or `file://` if CORS allows GLB fetch). No backend required after JSON/GLB are generated.

**Ingestion runtime:** Python 3.11+ venv with `pymupdf`, `opencv-python`, `extract-msg`, `pandas`, and HTTP clients for OpenAI/Anthropic APIs when schedule OCR/vision is needed.

---

## 5. High-level system requirements

### Functional

| ID | Requirement |
|---|---|
| F1 | Display building envelopes and equipment proxies in a browser WebGL scene |
| F2 | Select a spatial node via raycast and show spend history + current asset identity |
| F3 | Color nodes by aggregated cost thresholds (green / yellow / red) for a chosen time window |
| F4 | Support equipment replacement over time without moving or renaming the spatial node |
| F5 | Ingest drawing schedules into JSON that maps to `node_id` / drawing tags |
| F6 | Parse local email archives for location tags, equipment tags, and dollar amounts |

### Non-functional

| ID | Requirement |
|---|---|
| N1 | Core viewing path works offline after assets are built |
| N2 | Scene target: &lt; ~15 MB GLB; load under a few seconds on a mid-range laptop GPU |
| N3 | JSON ledgers human-readable and git-friendly where practical |
| N4 | No SaaS dependency for storage, auth, or rendering in the MVP viewer |
| N5 | LLM usage limited to batch drawing/schedule ingestion; never in the viewer hot path |
| N6 | Prefer deterministic regex/keyword matching for email cost tagging; LLM optional for ambiguous cases only |

### Explicit non-goals (MVP)

- Full BIM / Revit / IFC import  
- Suite-level interior modeling  
- Real-time IoT / BMS telemetry  
- Multi-user cloud sync  
- Photoreal materials or detailed mechanical routing  

---

## 6. Cross-document contracts (must stay aligned)

| Concept | Canonical name | Defined in |
|---|---|---|
| Permanent 3D anchor | `node_id` (`NODE_<ZONE>_<TYPE>_<NN>`) | [03](./03-3d-spatial-model-spec.md), [04](./04-email-parser-and-temporal-schema.md) |
| Drawing equipment tag | `drawing_tag` (e.g. `P-1`, `AHU-3`) | [02](./02-drawing-ingestion-and-filtering.md), [04](./04-email-parser-and-temporal-schema.md) |
| Static ledger | `nodes.json` | [04](./04-email-parser-and-temporal-schema.md) |
| Temporal ledger | `financials.json` | [04](./04-email-parser-and-temporal-schema.md) |
| Scene asset | `building.glb` (GLTF 2.0) | [03](./03-3d-spatial-model-spec.md), [05](./05-threejs-frontend-spec.md) |
| Heatmap bands | cost thresholds → material color | [05](./05-threejs-frontend-spec.md) |

Any future implementation prompt must treat these names as frozen unless all five docs are updated together.

---

## 7. Success criteria for a first vertical slice

1. One mechanical room (e.g. penthouse pumps) modeled with ≥3 spatial nodes.  
2. Schedules for those assets extracted to JSON and merged into `nodes.json`.  
3. ≥10 email-derived cost events linked to those nodes in `financials.json`.  
4. Three.js viewer loads `building.glb`, colors nodes by trailing 12-month spend, and shows a history popup on click.

When that slice works end-to-end, expand floor-by-floor and system-by-system using the same contracts.
