# 05 — Three.js Frontend Specification

**Status:** Specification (no implementation yet)  
**Related:** [01 Architecture](./01-architecture-overview.md) · [03 Spatial Model](./03-3d-spatial-model-spec.md) · [04 Email / Temporal Schema](./04-email-parser-and-temporal-schema.md)

---

## 1. Purpose

Define the **browser-based visualization tool** that loads the lightweight building GLB and overlays **cost heatmaps** on spatial nodes using client-side Three.js (WebGL).

MVP constraints:

- Static HTML/JS (no mandatory SPA framework)  
- Local static hosting  
- No LLM calls in the viewer  
- Reads only `building.glb`, `nodes.json`, `financials.json`

---

## 2. Functional requirements

| ID | Behavior |
|---|---|
| V1 | Load and display `assets/building.glb` with orbit controls |
| V2 | Resolve spatial nodes by GLB object name (`NODE_*` empties or proxies) |
| V3 | Apply green / yellow / red materials from `financials.aggregates[].heatmap_band` |
| V4 | Raycast click / tap to select a node |
| V5 | Show tooltip/popup: label, current asset, trailing spend, event history |
| V6 | Toggle envelopes opacity / visibility for readability |
| V7 | Legend for heatmap thresholds from `financials.thresholds` |
| V8 | Graceful empty states when a node has no aggregates/events |

Non-goals for MVP: editing nodes, uploading mail, BIM measurement tools, mobile-native apps.

---

## 3. Suggested viewer file layout

```
viewer/
  index.html
  styles.css
  main.js              # boot + wiring
  scene.js             # Three.js scene, lights, controls
  loaders.js           # GLTFLoader (+ optional DRACOLoader)
  heatmap.js           # band → material
  interaction.js       # raycaster, selection
  ui.js                # popup, legend, toggles
  config.js            # paths, defaults
```

CDN or local vendor copies of:

- `three` (r160+ recommended)  
- `three/addons/controls/OrbitControls.js`  
- `three/addons/loaders/GLTFLoader.js`  
- optional `DRACOLoader` only if GLB was Draco-compressed ([03](./03-3d-spatial-model-spec.md))

---

## 4. Boot sequence

```
1. fetch nodes.json
2. fetch financials.json
3. index aggregates by node_id
4. GLTFLoader.load(building.glb)
5. traverse scene:
     - collect NODE_* objects
     - collect PROXY_* meshes
     - tag envelopes for opacity toggle
6. for each node with proxy (else create marker mesh at empty position):
     apply heatmap material
7. bind pointer events → raycast
8. render loop
```

### 4.1 `config.js` (canonical paths)

```js
export const CONFIG = {
  glbUrl: "../assets/building.glb",
  nodesUrl: "../data/nodes.json",
  financialsUrl: "../data/financials.json",
  markerSize: 0.4,           // meters, if no proxy mesh
  envelopeOpacity: 0.35,
  highlightEmissive: 0x2244ff
};
```

Serve from a local static server so `fetch` / GLB load succeed (avoid brittle `file://` CORS issues).

---

## 5. GLTF import details

### 5.1 Loader

```text
GLTFLoader → gltf.scene added to THREE.Scene
Preserve object names from Blender export
```

Traversal pseudologic:

```text
gltf.scene.traverse((obj) => {
  if (obj.name.startsWith("NODE_")) nodes.set(obj.name, obj)
  if (obj.name.startsWith("PROXY_")) proxies.set(obj.name, obj)
  if (obj.name.startsWith("ENV_") || obj.name.startsWith("ROOM_")) envelopes.push(obj)
})
```

### 5.2 Binding to `nodes.json`

For each record in `nodes.json`:

1. Find `glb_object_name` in `nodes` map.  
2. Prefer coloring `proxy_object_name` mesh if present.  
3. Else create a `THREE.Mesh` (sphere/box) at the empty’s world position, size `CONFIG.markerSize`.  
4. Store `userData.node_id = node_id` on the pickable mesh.

Skip `status: decommissioned` from heatmap (or render muted gray).

### 5.3 Camera & controls

- `PerspectiveCamera` fov ~50  
- `OrbitControls` with damping  
- Initial frame: `Box3` of envelopes → `controls.target` at box center; position camera on isometric-ish vector  
- Min/max polar angle limits optional to prevent flipping under slab  

### 5.4 Lighting

Keep cheap:

- `AmbientLight` ~0.6  
- `DirectionalLight` ~0.8 from upper south-east  
- No shadows required for MVP (enable later only if cost is acceptable)

---

## 6. Heatmap materials

### 6.1 Band → color map

Align with `financials.thresholds` / `heatmap_band` ([04](./04-email-parser-and-temporal-schema.md)):

| Band | Hex | Meaning |
|---|---|---|
| `green` | `#2F9E44` | `total_amount <= green_max` |
| `yellow` | `#F1C40F` | between green and yellow max |
| `red` | `#E03131` | above `yellow_max` |
| `none` / missing | `#868E96` | no data in window |

### 6.2 Material rules

- Use `MeshStandardMaterial` or `MeshLambertMaterial` on proxies/markers.  
- Set `color` from band; keep `metalness` low, `roughness` high.  
- On hover/selection: raise `emissive` slightly (`CONFIG.highlightEmissive`) without losing band hue.  
- Do **not** bake heatmap into the GLB; always apply at runtime from JSON so thresholds can change without re-export.

### 6.3 Legend UI

HTML overlay listing threshold numbers from `financials.thresholds`:

```text
Trailing {trailing_months} months
● Green  ≤ {green_max} {currency}
● Yellow ≤ {yellow_max} {currency}
● Red    > {yellow_max} {currency}
● Gray   no data
```

---

## 7. Interaction: raycasting & selection

### 7.1 Pickables

Maintain `pickables: THREE.Object3D[]` = all proxy/marker meshes with `userData.node_id`.

### 7.2 Pointer flow

```
pointerdown/click on canvas
  → NDC from client coordinates
  → Raycaster.setFromCamera
  → intersectObjects(pickables, true)
  → first hit with userData.node_id wins
  → setSelection(node_id)
```

Clear selection on empty hit or Escape.

### 7.3 Selection feedback

- Restore previous material emissive  
- Highlight selected mesh  
- Open popup anchored to screen projection of node world position **or** fixed side panel (prefer **side panel** for readable history tables; optional floating label for name only)

---

## 8. Tooltip / popup content

Data join on select:

```text
node = nodesById[node_id]
aggregate = aggregatesById[node_id]
events = events.filter(e => e.node_id === node_id).sort_by date desc
currentAsset = node.assets.find(a => a.asset_id === node.current_asset_id)
```

### 8.1 Required fields shown

| Section | Content |
|---|---|
| Header | `label`, `node_id`, `drawing_tag` |
| Asset | manufacturer, model, installed_at (or “Unknown asset”) |
| Spend | `total_amount`, `event_count`, window label, band |
| History | table/list: date, type, amount, vendor, summary |

### 8.2 Empty states

- No aggregate → “No cost data in current window” + gray material already applied  
- No events → show node metadata only  
- Missing node in GLB → console warning at load; list in a small “unmapped nodes” debug panel (dev only)

---

## 9. Envelope visibility controls

Simple UI toggles:

| Control | Behavior |
|---|---|
| Envelopes opacity slider | Sets material opacity on `ENV_*` / `ROOM_*` meshes; `transparent = true` |
| Hide envelopes | `visible = false` for orientation-free equipment view |
| Heatmap only | Hide non-proxy meshes except selected context |

Ensure transparent envelopes do not block raycasts: set `envelope.raycast = () => {}` or put them in a non-pickable layer.

---

## 10. Performance guidelines

| Topic | Guidance |
|---|---|
| Draw calls | Few materials shared by band (3–4 materials total for heatmaps) |
| Persistence | `FrustumCulled` left on; avoid huge unmanaged line segments |
| Resize | Update camera aspect + renderer size on `window.resize` |
| Pixel ratio | `Math.min(window.devicePixelRatio, 2)` |
| JSON size | If `events` grows large, consider per-node lazy fetch later; MVP single file OK while &lt; ~2–3 MB |

---

## 11. Accessibility & UX minimums

- Keyboard: Escape clears selection; optional arrow cycle through nodes later  
- Color is not the only signal: popup shows numeric totals  
- Contrast: legend text readable on the viewer chrome  
- Loading indicator while GLB/JSON fetch  

---

## 12. Acceptance criteria (viewer vertical slice)

- [ ] Orbit around extruded envelopes for at least one floor + PH  
- [ ] ≥3 nodes colored by band from sample `financials.json`  
- [ ] Click node → side panel lists ≥1 historical event with amount  
- [ ] Node with no data renders gray and explains empty state  
- [ ] Changing thresholds in JSON + refresh updates colors without touching Blender  
- [ ] Works on a local static server in Chromium and Firefox  

---

## 13. Implementation notes for future prompts

When coding begins, prefer:

1. Small vanilla modules over a heavy framework  
2. Exact object-name contracts from [03](./03-3d-spatial-model-spec.md)  
3. Exact JSON contracts from [04](./04-email-parser-and-temporal-schema.md)  
4. No mutation of source GLB or JSON from the viewer (read-only)

The viewer is a **lens** on ledgers produced by the Python/Blender pipeline—not the system of record.
