# 03 — 3D Spatial Model Specification

**Status:** Specification (no implementation yet)  
**Related:** [01 Architecture](./01-architecture-overview.md) · [02 Drawing Ingestion](./02-drawing-ingestion-and-filtering.md) · [05 Three.js Frontend](./05-threejs-frontend-spec.md)

---

## 1. Purpose

Build a **minimalist spatial framework** in Blender that exports to **GLTF 2.0 / GLB** for Three.js. The model provides:

1. Building **envelopes** (extruded floor plates, cores, major rooms) for orientation  
2. **Spatial nodes** — permanent coordinate anchors for major equipment  
3. Optional **bounding proxies** (boxes/cylinders) for visual weight without BIM detail  

This is **not** a BIM deliverable. Prefer readable massing over accurate bolt-level geometry.

---

## 2. Coordinate system & units

| Setting | Value |
|---|---|
| Blender unit | 1.0 = **1 meter** |
| Up axis | **Z-up** in Blender; export with Y-up conversion for glTF (Blender glTF exporter default) |
| Origin | Building survey / SW corner of Level 01 slab (document exact point in file) |
| Scale lock | Apply scale (`Ctrl+A`) on all mesh objects before export; leave empties unscaled (1,1,1) |
| North | +Y in Blender before export (document rotation offset if plans are rotated) |

Store origin notes as a Blender text block or custom property `scene.meta_origin` so future edits stay aligned with PDF traces.

---

## 3. Scene hierarchy (Blender)

```
Scene Collection
├── ENVELOPES
│   ├── ENV_L01
│   ├── ENV_L02
│   ├── ...
│   ├── ENV_PH
│   ├── ENV_B1
│   └── ENV_CORE_STAIR_A
├── ROOMS                          # optional room boxes (mech rooms, elec rooms)
│   ├── ROOM_PH_MECH
│   └── ROOM_B1_PUMP
├── NODES                          # empties = spatial nodes (REQUIRED)
│   ├── NODE_PH_PUMP_01
│   ├── NODE_PH_AHU_03
│   └── NODE_B1_SWGR_01
├── PROXIES                        # optional low-poly meshes parented to nodes
│   ├── PROXY_PH_PUMP_01
│   └── ...
└── _REF                           # non-exported: PDF image planes, guides
    ├── REF_A101_L01
    └── ...
```

**Export rule:** exclude `_REF` from glTF export (disable collection or use export extras). Viewer only needs `ENVELOPES`, `ROOMS` (optional), `NODES`, `PROXIES`.

---

## 4. Envelope modeling guidelines

### 4.1 From PDF floor plans

1. Import curated architectural outline PDF/PNG as image plane (`_REF`).  
2. Trace outer slab and major voids with Bezier / poly curves (orthogonalize where appropriate).  
3. Convert to mesh, extrude to floor-to-floor height (use typical residential floor height from drawings; default **3.0 m** if unknown).  
4. Separate penthouse / mechanical bulkheads as distinct envelopes when height differs.  
5. Keep materials simple: single flat color per collection (envelope gray, room slightly darker).

### 4.2 Geometry budget

| Element | Guidance |
|---|---|
| Floor envelope | One mesh per level; &lt; 2k tris preferred |
| Room box | Axis-aligned box or simple L-shape; no windows/doors |
| Proxy equipment | Cube / cylinder / scaled box only |
| Whole building GLB | Target **&lt; 15 MB**; ideally **&lt; 5 MB** for early slices |

No subdivision surfaces, no dense boolean residue, no imported CAD line spaghetti.

### 4.3 Procedural / Geometry Nodes (optional)

Use Geometry Nodes for **equipment proxies** only when helpful:

- Input: empty location + custom props (`proxy_size_x/y/z`)  
- Output: bounding box mesh named `PROXY_<same suffix as node>`  

Do not procedurally generate floor envelopes from noisy CAD; manual trace is more reliable for MVP.

---

## 5. Spatial nodes

### 5.1 Definition

A **spatial node** is a permanent world-space anchor representing a maintainable asset location. It survives equipment replacement, vendor changes, and proxy mesh rebuilds.

In Blender: an **Empty** (Plain Axes or Sphere) named exactly with the `node_id`.

### 5.2 Naming convention

```
NODE_<ZONE>_<TYPE>_<NN>
```

| Segment | Meaning | Examples |
|---|---|---|
| `ZONE` | Coarse location | `PH`, `ROOF`, `B1`, `B2`, `L01`, `L12`, `CORE` |
| `TYPE` | Equipment class code | `PUMP`, `AHU`, `EF`, `GEN`, `ATS`, `SWGR`, `DHW`, `BOIL`, `CH`, `HX`, `ELEV` |
| `NN` | Zero-padded index within zone+type | `01`, `02` |

Examples:

- `NODE_PH_PUMP_01` ↔ drawing tag `P-1`  
- `NODE_PH_AHU_03` ↔ `AHU-3`  
- `NODE_B1_SWGR_01` ↔ `MSB-1` / `SWGR-1`  
- `NODE_B1_GEN_01` ↔ `EG-1`

### 5.3 Custom properties on each Empty

Set these Blender custom properties (exported via glTF extras if enabled):

| Property | Type | Example | Required |
|---|---|---|---|
| `node_id` | string | `NODE_PH_PUMP_01` | yes (must match object name) |
| `drawing_tag` | string | `P-1` | yes when known |
| `discipline` | string | `plumbing` | yes |
| `equipment_type` | string | `pump_booster` | yes |
| `zone` | string | `PH` | yes |
| `label` | string | `Penthouse booster pump 1` | recommended |

Authoritative business metadata still lives in `nodes.json` ([04](./04-email-parser-and-temporal-schema.md)). Blender props exist so the GLB remains self-describing if JSON is missing during modeling QA.

### 5.4 Placement rules

1. Place empty at the **equipment centroid** on the plan (or center of tagged symbol).  
2. Z = finished floor of that room + half proxy height (or +1.0 m if no proxy).  
3. One node per maintainable asset; do not create nodes for every diffuser or outlet.  
4. If equipment moves within the same room during a renovation, **keep `node_id`**, update empty transform, and record the change in `financials.json` / asset history—not a new node—unless the location is conceptually a different permanent slot.  
5. Parent optional `PROXY_*` mesh to the empty so transforms stay linked.

### 5.5 Mapping worksheet (human gate)

Before export, maintain a simple table (spreadsheet or markdown):

| node_id | drawing_tag | sheet | blender_object | confirmed |
|---|---|---|---|---|
| NODE_PH_PUMP_01 | P-1 | P-601 / M-201 | NODE_PH_PUMP_01 | yes |

This table is the bridge from [02](./02-drawing-ingestion-and-filtering.md) schedule extraction to the GLB.

---

## 6. Materials (Blender → viewer)

Viewer applies **runtime heatmap colors** on node proxies ([05](./05-threejs-frontend-spec.md)). Blender materials are defaults only:

| Collection | Default color (approx.) | Notes |
|---|---|---|
| ENVELOPES | `#C8CDD3` | Transparent optional (alpha ~0.3) for see-through floors |
| ROOMS | `#A8B0BA` | Slightly darker |
| PROXIES | `#6B7280` | Overridden at runtime by heatmap |
| NODES | n/a (empties) | Three.js may spawn marker meshes at empty positions |

Use **Principled BSDF**, no dense texture maps. Prefer vertex color only if needed for debugging zones.

---

## 7. GLTF / GLB export settings (Blender)

Use Blender’s built-in **glTF 2.0** exporter.

| Setting | Value | Why |
|---|---|---|
| Format | **glTF Binary (.glb)** | Single file for the viewer |
| Include | Selected / visible collections only; exclude `_REF` | Smaller payload |
| Transform | `+Y Up` | glTF / Three.js convention |
| Geometry → Apply Modifiers | **On** | Bake Geometry Nodes proxies |
| Geometry → UVs / Normals | Normals on; UVs off if unused | Smaller file |
| Compression | ** Draco optional** | Use only if Three.js `DRACOLoader` will be configured ([05](./05-threejs-frontend-spec.md)) |
| Materials | Export | Simple materials OK |
| Animation | Off | Not used in MVP |
| Skinning / Morph | Off | Not used |
| Custom Properties | **On** | Preserve `node_id` extras on empties |
| Cameras / Lights | Off | Viewer creates its own |

### 7.1 Node empties in GLTF

Confirm empties export as nodes in the GLTF scene graph with names intact (`NODE_…`). Three.js `GLTFLoader` will expose them in `gltf.scene` for lookup by name.

If empties are stripped by a pipeline step, fall back to zero-volume marker meshes named with `node_id` (still preferable to losing anchors).

### 7.2 Export QA checklist

- [ ] Object names match `node_id` exactly  
- [ ] All scales applied on meshes  
- [ ] No duplicate `node_id` names  
- [ ] `_REF` excluded  
- [ ] File size within budget  
- [ ] Opens in https://gltf-viewer.donmccurdy.com/ with nodes visible in hierarchy  
- [ ] Spot-check 3 node world positions against plan dimensions  

Output path (canonical): `assets/building.glb`

---

## 8. Versioning the spatial model

| Change type | Action |
|---|---|
| Move node slightly for accuracy | Update Blender + re-export GLB; **keep** `node_id` |
| Replace equipment at same slot | No Blender rename; update `nodes.json` current asset + `financials.json` event |
| Add new equipment location | New `NODE_*` empty + proxy; append `nodes.json` |
| Remove decommissioned slot | Soft-retire in `nodes.json` (`status: decommissioned`); keep empty or hide proxy—do not reuse ID |

GLB filename may include a revision suffix during work (`building_r012.glb`); the viewer config should point at the current canonical `building.glb`.

---

## 9. Handoff

| Artifact | Consumer |
|---|---|
| `building.glb` | Three.js viewer ([05](./05-threejs-frontend-spec.md)) |
| Node name / extras | Join to `nodes.json` / `financials.json` ([04](./04-email-parser-and-temporal-schema.md)) |
| Mapping worksheet | QA + email alias dictionary (`drawing_tag` list) |
