# Changelog

All notable changes to the Condo Board AI Assistant are recorded here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **Build-out progress modal mobile layout** — On small screens the Gantt chart now uses the full modal height with narrower columns and horizontal scroll. The details sidebar is hidden; tapping any timeline row or phase bar opens a bottom sheet with the item summary and remaining work.

- **Meetings V2 workspace UI cleanup** — Tightened vertical spacing across the detail page header, cards, and alerts. Tabs (Overview, Agenda Review, Draft Preview, Pipeline) now appear only after a successful validated run; incomplete or stopped runs show a compact pre-run status panel instead of misleading readiness metrics. Combined Meeting Readiness and Health Summary into a single overview card. Merged View Transcript and View Board Package into a tabbed Meeting Documents dialog. Replaced separate Resume/Restart buttons with a split pipeline action control. Moved Generate Draft into the Draft Preview tab with clearer labeling. Pipeline start/resume is disabled when transcript or board package files are missing locally. Header layout: workspace badge beside back link; three-column header with progress centered and action controls stacked in a right column.

- **AI usage dialog WatsonX tab** — The AI usage & cost popup now has Usage and WatsonX tabs. WatsonX shows IBM watsonx Docling trial key slots, spend, and .env.local variable reference.

### Added

- **Meetings V2 selective Docling extraction** — Integrated IBM Watsonx Docling into board package ingestion for the core meeting agenda and management report pages (first 10–20 pages, before email attachments). Provides high-fidelity Markdown and structured headings for agenda items, bid tables, and financials, while leaving the remaining 180+ email attachment pages to fast local PDF parsing.

### Fixed

- **Meetings V2 extraction quality false-positive stop** — Fixed heuristic detector in `analyzeExtractionQuality` where valid DeepSeek agenda items were falsely flagged as `section_shaped_output` solely because `sourceSectionId` was attached. The detector now compares extracted titles against PDF section titles and verifies `itemType === "agenda_section"`.

- **Meetings V2 agenda item ordering** — Removed alphabetical title tie-breaker in `sortTopics()`. Extracted agenda topics discovered on the same page now strictly preserve their original document encounter sequence rather than being alphabetized.

- **Meetings V2 pipeline alerts** — Halted runs now show rose "Stopped" cards
  instead of amber warnings, listed newest-first with a Latest badge. Duplicate
  lastError text that restated the extraction note is omitted. Overview shows a
  three-column got-vs-expected comparison (this run, PDF page splits, typical
  semantic topics) so section-shaped DeepSeek output is visible without opening
  the Pipeline tab.

### Changed

- **Highlighted unit walls are a 6-inch shell of the labeled room fill** — Asset
  overview no longer extrudes drawn wall polylines into a highlighted unit. The
  opaque enclosure follows the 2D unit polygon silhouette (T-stem spikes that
  enclose no floor are dropped). Drawn walls stay on the faded global shell.

- **3D building camera & unit labels** — Swapped orbit controls so left-drag pans and
  middle-drag (mouse wheel button) rotates; scroll wheel now zooms toward the cursor
  instead of the viewport center. Highlighted unit labels use fixed screen-pixel size
  (larger text) so they stay readable at any zoom level. Turning on a unit highlight
  now automatically drops shell wall and slab opacity to 5%.

- **Build-out progress dialog** — Replaced the long vertical card list with a
  wider Gantt-style execution timeline: phase columns (parallel, blocked, after,
  later, parked), compact swimlane rows for the playbook and inventory, sticky
  workstream labels, and a side detail panel on row select.

### Added

- **3D Unit Highlighting & Selective Wall Transparency** — In Building → Asset overview & 3D,
  added the ability to search, select, and highlight individual units with selective wall
  transparency preservation:
  - **Unit search & toggle panel**: Dedicated "Units" tab in the 3D control drawer with instant
    text search by unit number (e.g., "101", "204"), floor quick-filter buttons ("All Floors",
    "Floor 1", etc.), bulk "Highlight all" and "Clear all" buttons, active highlight tags,
    and individual unit toggle checkboxes with unit color swatches.
  - **Opaque unit geometry**: When units are toggled on, their floor boundaries render as
    solid 3D plates with 100% opacity (no transparency) and interactive 3D billboard labels
    indicating the unit number.
  - **Selective wall transparency**: Walls touching the perimeter or interior of highlighted units
    remain 100% opaque, while all other walls in the building obey the shell transparency
    slider (`wallOpacity`). Users can drag the wall opacity slider down to make surrounding
    walls semi-transparent or invisible while keeping highlighted units and their enclosing
    walls prominently visible.
  - **Geometric wall-touching detection**: Pinpoints wall segments that overlap unit boundaries
    or lie within unit footprints, distinguishing unit boundary runs from exterior walls of
    adjacent units at corner vertices.
  - **Cross-tab sync**: Active highlighted unit counts reflect on the "Units" tab header and
    on the "Layers" tab's Structure Shell panel with one-click clear and view shortcuts.

- **Phase 3 3D building interactivity, visibility & layer filtering** — The 3D
  Digital Twin viewer at Building → Asset overview & 3D now includes comprehensive
  layer controls, material opacity sliders, floor slicing, click-to-inspect
  raycasting, and quick view presets:
  - **Quick view presets**: One-click preset buttons for "Reset Full Building",
    "Mechanical Only" (hides all slabs/walls to isolate the 3D pipe network),
    "Only HC" (isolates Heating & Cooling risers with ghosted structure),
    "Sanitary & Laundry" (isolates drainage risers), "Floors 8–10" (slices to
    specific tower plates), and "Structure Only" (slabs and walls without risers).
  - **Structure opacity & visibility controls**: Individual toggles and 0–100%
    opacity sliders for both walls and slabs, allowing users to make walls translucent
    to see pipes running inside internal wall cavities or isolate slabs completely.
  - **Interactive click-to-inspect with scene dimming**: Clicking any 3D pipe sweep
    or equipment primitive dims the surrounding scene (non-selected pipes to 18%
    opacity, structure dimmed) and highlights the target run in electric cyan.
    Displays an interactive floating Inspector Card showing nominal diameter, total
    run length, elevation span, spanned floors, and connected level chips with
    one-click "Isolate Riser Run" and "Filter Floors" actions.
  - **Floor slicing and isolation**: Level filtering supporting "All Floors",
    "Range" (with quick buttons for Basement, Podium 1–7, Tower 8–24, Upper),
    and "Single Level" selection for both structural geometry and mechanical runs.
  Building → Asset overview & 3D now renders continuous 3D volumetric pipe
  runs (`TubeGeometry`) connecting 2D mechanical riser nodes across floors.
  Vertical runs transition into smooth filleted elbows at horizontal offset
  jogs (podium/tower transfer levels) using `QuadraticBezierCurve3` to avoid
  pinched miter glitches. Pipes are styled by system type colors matching the
  2D floor plan editor presets (Kitchen, Toilet, Laundry, HC, RWL, Heat pump).
  Added terminal equipment bounding primitives at bottom sumps/collectors and
  top terminal vent cowls. A dedicated control panel provides system layer
  checkboxes, pipe opacity slider, equipment toggles, and click-to-inspect
  metadata banners showing pipe diameter, length, and floor range.

### Fixed

- **Building 3D Unit Search Duplicate Keys** — Fixed a React duplicate key error
  (`Encountered two children with the same key, '7:708'`) occurring when switching
  to the "Units" tab or selecting units that have multiple room polygons or duplicate
  annotations on the same floor level:
  - Deduplicated unit listings in `UnitSearchControls` by `unitId` so that multi-polygon
    or multi-room units appear as a single entry in the search list and active highlight chips.
  - Deduplicated `touchingUnitIds` in `extrudeWalls` when a wall segment borders multiple
    polygons of the same unit.
  - Scoped 3D scene graph group names to unique unit annotation keys.

- **Riser standardization dialog clip & placement** — The template preview now
  zooms small clips for editing while keeping true PDF scale for shape sizes.
  The sample freehand riser is chosen from the clip you drew (not always the
  first riser on the floor), so placed circles and rectangles appear on the
  clip instead of thousands of points away. New sessions start with an empty
  template instead of an auto-added rectangle sized to the floor average.
  Clip previews rasterize at display resolution (no CSS upscaling blur). The
  sample riser box in the preview uses the same solid stroke as on the plan
  (not a dashed pink overlay). The clip-region drag rectangle keeps a constant
  screen stroke width when panning/zooming the sheet. Template shapes in the
  clip preview use click-drag drawing (Shift = square) like the main canvas box
  tools, with matching on-screen stroke weights.

- **Compare lines overlay toolbar** — The **Lines overlay** control (and onion
  skin slider) lived in a footer bar that was easy to miss in full-screen
  compare and could sit below the fold in the inline panel. Both now sit in
  the compare toolbar: a second row under the title in expanded mode, and
  above the canvas in inline mode.

- **Extending a line no longer freezes then crashes** — Holding **Shift**
  while dragging a polyline vertex (ortho constraint or Shift-click) used
  to re-run the vertex update on every key-repeat. Each pass rebuilt the
  room graph, so a traced floor hung for several seconds and then threw
  “Maximum update depth exceeded.” Shift now applies once on press and
  once on release, and the room graph waits until the drag ends.

### Changed

- **Build-out progress popup** — Curated statuses refreshed (reviewed
  2026-09-04). **3D digital twin** and new **Floor plan markup & mechanical
  risers** are in progress (massing, riser sweeps, unit highlight, 2D tracing).
  **Board meeting review (v2 pipeline)** added. Projects, entity profiles,
  and to-do click-in reflect shipped work since the August review. Playbook
  sequence leads with floor-plan tracing, 3D verification, projects lab, and
  meetings v2 QA in parallel.

- **Room leak glow** — Hairline near-miss gaps now bloom harder: wider
  radius, higher opacity, thicker stroke, and a small anchor dot on the
  smallest leaks so the red emanation is easier to spot on dense sheets.

- **Riser standardization uses a plan-scale drawing clip** — Clicking
  **Standardize** now prompts you to draw a reference rectangle on the
  floor plan. The dialog opens with that region rasterized at true PDF
  scale (1 pt = 1 px) so circles and rectangles can be placed and dragged
  directly over the drawing. The dashed pink box shows the sample freehand
  riser rectangle for alignment.

### Added

- **Standardize Mechanical Riser Shapes & Templates** — In the 2D floor plan editor, users can now define standardized shape templates for each mechanical riser type (e.g., toilet, kitchen, laundry). Templates support custom dimensions for rectangles as well as multi-circle configurations (such as the standard 3-circle toilet riser cluster with concentric or crosshair/filled variations). Clicking **Standardize** centers the defined template layout within every corresponding freehand rectangle on the plan (or across all floors in the building) and replaces the freehand boxes while preserving callout labels, riser connections, and orientations.

- **2D blueprint texture overlay on 3D floor slabs** — Each 3D floor slab
  in the building model viewer now maps its exact 2D architectural source
  drawing onto its top face. Aligned 1:1 with extruded walls and columns
  via the building pin datum, the blueprint plane uses a +0.01 m elevation
  offset with GPU polygonOffset to prevent surface flickering. A floating
  overlay control provides global show/hide, a 0–100% opacity slider, and
  level-by-level visibility checkboxes to inspect individual floors.

- **Real 3D building massing** — Building → Asset overview & 3D now stacks
  slabs and extruded walls from pinned, cropped architectural floor plans
  instead of the placeholder parking/podium/tower boxes. Each ready floor
  snaps to the shared building pin, converts PDF points with the family
  scale (1:100 if unset), and uses 3.5 m storeys with 200 mm slabs and
  150 mm walls. Missing floors are not invented; unready or duplicate
  sheets are skipped with a count on the viewer.

- **Riser label visibility** — Toggle mechanical riser callout labels (Sanitary
  B11, etc.) on or off in edit mode (**View → riser labels**) and compare mode
  (**Riser labels** checkbox). Boxes and lines stay visible; only the callout
  bubbles and leaders hide. The choice persists in the edit ribbon session.

- **Compare overlay line types** — Compare still stacks architectural or
  mechanical drawings separately. Overlay strokes on those sheets now use
  the same **Lines overlay** checkboxes as edit mode: all types, all
  architectural, all mechanical, or individual colors. Checking mechanical
  while comparing architectural drawings pin-maps that floor's mechanical
  markup onto the stacked plates (and the reverse).

- **Drag floor-plan shapes** — In Select (**V**), click a rectangle, circle,
  line, or unit and drag it to a new position. Arrow keys still nudge by a
  pixel. Grab a polyline vertex to reshape it as before.

- **Room leak glow** — In Room (**U**), hovering a space that is almost
  closed lights a red bloom on wall gaps smaller than the leak threshold
  (default 12 PDF points). Doorways and large openings stay dark. A **Leak**
  slider next to the unit list sets that threshold from 3 to 48 points.

- **Room tool for unit enclosures** — The edit ribbon **Tools** group has a
  Room control (**U**) next to rectangle and circle. Hover over a space
  enclosed by drawn walls to preview the whole perimeter; gaps show no
  highlight. Click to define that area as a unit and type the unit number.
  Riser boxes inside a unit do not steal the hover face.

- **Tagged riser list by floor** — The edit ribbon **Risers** group has a
  **List** toggle. It opens a side panel over the drawing that lists every
  tagged riser on each floor, grouped by type (legend colors) and then by
  number. Floors and types are collapsible; the floor you are on starts
  expanded. Use it to check whether a riser seen on a higher floor was
  already tagged below.

- **Rotate floor-plan boxes** — The edit ribbon **Tools** group has a
  rotate control (**T**). Click and hold a rectangle or circle to spin it
  around its center through 360°. Hold **Shift** to snap to 45° increments
  (0, 45, 90, 135, 180, …). Connection place-from-below copies the source
  rotation onto the new box.

- **Follow one riser up the building** — The edit ribbon **Risers** group
  has a dropdown of catalog instances you have created. Selecting one shows
  that box from the floor immediately below as a dashed overlay. Each overlay
  has **approve**, **move**, and **dismiss** controls: approve writes that
  box to this floor, dismiss skips it because the stack does not continue,
  and move (drag or arrow keys) nudges it on this floor only. Saved boxes
  look like ordinary markup. **Not following** hides overlays that were not
  approved. An **Open / Done** toggle marks a stack completed so it stops
  overlaying once you have traced it to its top floor.

- **Mechanical riser catalog** — Mechanical types (color, shortcut, name) are
  stored as official records, not freeform legend text. Callout mode (**A**) on
  a mechanical sheet picks a type and a number; if that number is new, it is
  added to the riser table and reused on other floors. Architectural lines stay
  unlabeled for now.

- **Floor plan box callouts** — Callout mode (**A**) on mechanical drawings
  labels a rectangle or circle with a catalog type and number. The bubble stays
  movable with a leader on the box edge. Click the bubble again to change the
  assignment; the × on an editing callout removes it.

- **Floor plan riser connections** — Connection mode (**K**) links two boxes:
  click the position that continues up, then the lower position. An arrow
  points from the above box to the lower one, with **ABV** under the above
  box. Overlaying or adding lines to a higher floor copies unpaired boxes as
  usual and only the above box from each pair.

- **Mechanical floor plans** — Families can be architectural or mechanical.
  Mechanical floors upload as overlapping east and west PDFs. Align them with
  translucent overlay, crop each sheet to building content (dropping title
  blocks and sheet borders), merge into one sheet, then pin, crop, and draw
  as usual. Edit and Compare cycle architectural or mechanical drawings
  separately; compare only includes merged, pinned, and cropped mechanical
  sheets.

- **Floor plan line overlay families** — Legend types are architectural or
  mechanical (color, shortcut, and family). The overlay popover groups them
  with All types, All architectural, and All mechanical. Checking
  architectural types on a mechanical sheet shows that floor's architectural
  lines; the separate Architectural lines button is gone.

### Changed

- **A combined riser can have several connection arrows** — Connection mode
  no longer replaces the first pair when you link the same box again. A
  toilet stack labeled B11 and B12 can have one arrow to the B11 box and
  another to B12 (or three arrows for three ids). Double-click one split
  box to drop only that branch; the other arrows stay.

- **Changing a mechanical riser type moves the whole stack** — With labels
  already on a callout, picking a different type (kitchen → toilet) updates
  that catalog row everywhere: every floor's callout follows, boxes recolor,
  and a colliding same-number on the new type is merged. Line strokes stay
  as drawn.

- **Connecting a multi-riser callout asks which stacks continue** — When
  connection mode links two boxes and only one is labeled with more than one
  catalog number (e.g. B-11, 12), a prompt lets you pick which one(s) the
  unlabeled box is. The original callout stays combined; the copy gets only
  the chosen subset, so a three-riser shaft can split into two-plus-one and
  later into three distinct stacks. After clicking the source box (saved or
  a follow overlay), a second click on empty canvas places a same-size ABV
  copy at that center. The source is the from-below (not ABV) box, so the
  arrow points at it. A follow overlay is written to this floor as that
  below box. Follow mode can still hide untagged markup.

- **Follow overlays keep combined riser labels** — A box labeled with more
  than one catalog id on the floor below (Kitchen B2, B3) overlays as that
  same combined callout, not only the one id you happened to follow. Approve
  still writes that one box. Ids already saved on this floor, dismissed, or
  marked completed are dropped from the overlay.

- **Follow riser overlays are reviewed per box** — Choosing risers still
  previews boxes from the sheet immediately below (pin-mapped). Unsaved
  overlays are dashed and editable one at a time: approve keeps that box,
  dismiss hides it on this floor, and move adjusts it here without changing
  the floor below. **Save lines** no longer dumps the whole overlay.

- **Floor plan drawing tools** — The Tools group now wraps onto two rows so
  Select, Line, Rectangle, Circle, Cut, Connection, and Callout take less
  horizontal space on the edit ribbon.

- **Floor plan markup stroke width** — Line and rectangle strokes now render at
  the chosen screen-pixel width (e.g. 8 px stays 8 px on screen) instead of
  shrinking with the page layout scale, which had made saved walls look hairline-thin
  on large architectural sheets.

- **Floor plan drawing tool shortcuts** — **V** selects markup, **L** draws lines,
  **R** draws rectangles, and **C** cuts segments. Tooltips on the edit ribbon
  show the keys.

- **Floor plans split drawing name and floor number** — Each sheet now has a
  drawing name (e.g. `An212`) and a separate integer floor number. Folder
  view sorts by family drag order, then floor number lowest to highest; with
  folders off, the list is floor number only. Existing labels like
  `An212 - Floor 12` are split on migrate.

- **Floor plan crop waits for the pin** — On a new sheet in a family that
  already has a crop plate, the blue rectangle stays hidden until the
  registration pin is placed. It then appears using the nearest cropped
  sibling's pin offset (not the building registration floor). A brand-new
  family with no plate yet still shows the rectangle immediately so the
  first crop can be drawn.

- **Floor plan pin is per building** — The first imported drawing places one
  registration pin on that original PDF. Every other floor marks the same
  point on its own PDF so all sheets share that pin; cropping stays per
  family and happens after the pin is set. The previous family-level pin on
  the cropped plate is gone.

### Fixed

- **Lines overlay type filter** — Unchecking one line type (for example Heat
  pump) no longer hides other checked equipment whose boxes were drawn with an
  architectural stroke color (for example Elec closet or Garbage chute). The
  overlay now filters by every checked type color, not only colors assigned to
  the source drawing set’s family.

- **Follow approve survives changing floors** — Approving a followed riser
  (with or without moving it) only wrote that box into this floor’s unsaved
  markup. Switching sheets remounts the editor, and the empty first paint could
  replace that draft. Coming back then showed the dashed overlay again, as if
  you had never approved. Approve now writes the draft immediately, remounts
  wait until markup has loaded before persisting, and an empty preload cannot
  overwrite a draft that already has work.

- **Riser list click pans to the callout** — Clicking a tagged riser in the
  side panel treated PDF Y as if the page origin were top-left. Horizontal
  pan was right; vertical pan inverted, so stacks near the middle of the
  sheet looked roughly centered while stacks nearer the top or bottom landed
  off-screen. The jump now uses the same Y-flipped canvas space as the pin.

- **Floor 2 Pass 2 labels in the riser list** — Opening a mechanical sheet
  while Pass 2 was remembered in the ribbon still loaded Pass 1 boxes. Floor 2
  looked unlabeled and every followed riser showed as unapproved, even though
  the Pass 2 tags were saved. Markup now waits for the ribbon to hydrate
  before choosing which pass to draw.

- **Multi-riser callout labels** — Assigning more than one riser to a callout
  no longer prefixes the label with the draw-tool keyboard shortcut (e.g.
  `1-B2, B3`). Labels always use the riser type name and the catalog numbers
  you entered (e.g. `Riser - Kitchen B2, B3`).

- **Follow riser across floor families** — Each mechanical level is often its
  own family (different crop plates). Follow looks at the floor immediately
  below in the building, not only a sibling in the same family, so B11 on
  Floor 1 can overlay onto Floor 2.

- **Floor plan edit pan across drawings** — Switching floors in edit mode kept
  zoom but walked the sheet down and to the right on every floor. The editor
  remounts per drawing, so the first viewport measurement was treated as a
  grow from 0×0 and recentered by half the window. That first size now only
  seeds the baseline; later real resizes still recenter.

- **Floor plan PDF upload drop zone** — Clicking “browse” in the left-panel
  upload area no longer scrolls the page upward (worse as the drawing list
  grows). The plan list scrolls independently with the upload footer pinned,
  and the hidden file input no longer steals focus. Expanded crop view also
  recenters when its viewport size changes instead of drifting until you zoom.

- **Floor plan edit ribbon hydration** — The stroke-color dropdown no longer
  mismatches server HTML on first load. Saved ribbon settings (color, tool,
  overlays) still restore from localStorage, but only after the client has
  hydrated, so React does not throw a recoverable hydration error.

- **Mechanical callout catalog editor** — The type/number picker is a real
  overlay instead of a clipped SVG form, so both fields are readable. Changing
  the type keeps that choice when you click away; typing a number and clicking
  the sheet saves it.

- **Floor plan edit ribbon and view persist across drawings** — Switching
  floors in edit mode no longer resets the tool, stroke width, crop/pin/line
  visibility, or the zoom. The next sheet stays at the same zoom with the
  building pin on the same screen pixel, so you keep looking at the same
  place in the building.

- **Floor plan empty-floor line overlay** — Edit mode no longer paints another
  floor's saved lines onto a sheet that has no markup of its own. That made
  podium mechanical floors above the last traced level look fully annotated.
  **Lines overlay** still shows them when you turn it on; **Add overlay lines**
  still copies them onto the current floor.

- **Mechanical sheet merge editor** — Aligning east and west sheets
  re-rasterizes the visible region (plus a pan overscan) when zoom, viewport
  size, or a large pan changes, not on every pointer move. Dragging CSS-
  translates the already-loaded clip so the sheet does not flash a pdf.js
  reload; after the pan settles, the newly visible strip is filled in. Merge
  stamps each sheet in pdf.js visual space after flattening `/Rotate`, so a
  90° MediaBox no longer turns the drawing on its side or pulls title-block
  strips into the crop. If the family already has a crop plate larger than
  the overlapped sheets, the merged page is padded so opening the crop
  editor no longer throws `Crop is larger than the PDF page`. Arrow-key
  nudges move the drawing with the selection outline. Align mode no longer
  shades crop margins; those stay in Crop so you can see the keep-region
  against the full sheet. Crop handles show the matching resize cursor on
  hover.

### Added

- **Floor plan line persistence and overlay** — Lines and rectangles drawn in
  edit mode are saved per floor. A **Save lines** button appears when markup
  differs from what is stored. A separate **Lines overlay** control shows saved
  markup from other floors (pin-aligned), listing only floors that have saved
  lines.

- **Floor plan family drag-and-drop** — On Building → Floor plans, drag a
  drawing by its grip handle in the left sidebar onto another family to
  reassign it. Cropped sheets adopt the target family's plate size when
  needed; moving the first cropped sheet into an empty family sets that
  family's crop dimensions.

- **Floor plan family order** — Each family in the left sidebar has Up and
  Down controls so parking, podium, and tower groups can be reordered
  without recreating them.

- **Floor plan crop overlay** — Overlay is optional: toggle it, pick which
  cropped sibling to show from a dropdown, and the rectangle turns violet
  while overlay is on. Overlay locks W×H to that sibling (move only). With
  overlay off, later floors keep resize handles like the first crop.

- **Full-screen floor plan pin** — The pin step now has the same Expand
  control as crop. Full screen lets you zoom (buttons, Fit, and scroll
  wheel) and pan (drag the sheet; a short click still plants the pin) so
  the registration mark can be placed on a corner or shaft instead of
  guessing from the inline overview.

- **Full-screen floor plan crop** — Building → Floor plans has an Expand
  control at the top right of the crop pane. It opens a full-screen editor
  with pan (drag the sheet, or Space-drag over the crop rectangle) and zoom
  (buttons, Fit, and scroll wheel) so the blue crop rectangle can be placed
  more precisely.

- **Floor plan crop and alignment** — Building → Floor plans uploads one
  PDF per level into named families (parking vs occupied floors). Crop to
  the plate (first crop locks size for that family), then mark a shared
  registration point such as an elevator-shaft corner. Previous / Next
  open a compare session that preloads cropped sheets in a family; an optional overlay from another
  family lines up on the pin so different footprints still share an origin.
  Notes and names stay on each sheet. This is the drawing-prep step before
  the real 3D massing; it does not replace the proof-of-concept viewer yet.

- **Per-alias organization mention counts** — The Organizations registry
  detail panel shows distinct confirmed/provisional mention emails next to
  each “Also known as” row (e.g. `TCG · 12 emails`, or `—` when none). The
  org total stays a union across surfaces, not a sum of alias rows.
  Confirming a mention from the harvest tooltip invalidates the cached
  list so those counts refresh.

- **Organization mentions** — Pass-3 org cards persist to
  `organization_mentions` (same staging pattern as contacts/projects). A
  per-email decision confirms only on this message’s unique mailbox,
  website, distinctive name, short unique alias, or header domain. Bare
  `Trace` stays unresolved with Consulting / Fire / Maintenance as
  candidates. Unique body spans paint harvest marks; unresolved org and
  contact badges use a dashed ring and a hover candidate list (click still
  opens the panel). `backfill:org-mentions` replays stored pass-3 cards.
  The Organizations registry shows backfill progress (including CLI runs)
  with a live bar and resolved mention counts.

- **Entity profile click-through** — Click a harvest mark, a Global To-Dos
  mention, or a registry name (Contacts / Organizations / Projects /
  Equipment) to open a shared letterhead side panel. Hover stays a preview.
  Harvest fingerprints resolve to a registry card only on a unique email,
  phone, name, or project-year match; otherwise the panel notes the mention
  is not linked yet. Person cards include a role-based “get me involved
  when” prompt from the job title (not email history).

- **`backfill:project-mentions`** — One-time CLI copies stored pass-3 project
  fingerprint cards into `project_mentions` and runs the matcher (no Gemini).
  Dry-run by default; `--apply` persists. Skips emails that already have
  mentions unless `--force`. Use when the Mentions tab is empty but pass-3
  JSON exists from prior harvests.

- **Inbox harvest failure banners** — Re-harvest C+P, bulk extract, and
  Re-harvest thread now show green / amber / red notices when passes finish,
  including per-email API errors (e.g. Gemini spending cap) that previously
  returned HTTP 200 with empty cards.

### Changed

- **Floor plan compare session** — Previous / Next (and Expand) open a
  full-screen compare view that preloads every cropped sheet in the family.
  Switching is instant once they are painted; Close drops the canvases and
  cached PDF bytes so memory does not stay high.

- **Floor plan crop side handles** — The blue crop rectangle has handles in
  the middle of each side, so you can change only the width or only the
  height. After placing the left edge you can pan to the right of the sheet
  and drag the right handle without moving the top or bottom.

- **Floor plan PDF upload** — Building → Floor plans replaces the file
  picker in the left panel with a dashed drop zone. Drop or click to choose
  a PDF, then Upload.

- **12-character org alias gate retired** — Profile snippets already paint
  every registry alias plus stored mention spans. Auto-confirm treats aliases
  as surfaces (TCG confirms when unique; Trace stays unresolved on prefix
  collision). Fingerprint harvest-name bucketing is a fallback when an org
  has no mention overlay, and now uses the same prefix-collision test instead
  of a 12-character length cutoff. Harvest token-paint for short strings
  without offsets is unchanged.

- **Entity profile highlights every org alias** — Wikipedia-style org email
  snippets paint the canonical name and all aliases (including short
  surfaces such as TCG and Trace) in the subject and body preview. Selecting
  an alias in the registry or on the profile keeps that surface at full
  strength and fades sibling aliases in the same violet. The email list
  still comes from stored mentions, not Command-F / LIKE.

- **Wikipedia org emails use resolved mention ids** — Opening an organization
  lists emails from confirmed/provisional `organization_mentions`, not
  distinctive-alias LIKE / Command-F. Snippets paint from stored unique
  spans. Short unique aliases such as TCG confirm when they are not a
  prefix of another org’s primary name. Registry source-email counts overlay
  the same distinct resolved emails once backfill has rows.

- **Gemini 3.7 Flash as the default model** — Harvest, identity review, minutes,
  to-dos, omissions, email analysis, and page vision now default to
  `gemini-3.7-flash`. Gemini 3.6 and 3.7 Flash share the same paid rates:
  50% intro through 2026-12-31 ($0.75 / $3.75 per 1M tokens) then list
  $1.50 / $7.50 from 2027-01-01.
  Older Flash and Pro ids stay in the pickers. Stored analysis-settings rows
  still on 2.5 / 3.5 / 3.6 Flash are migrated. The Profile minutes/to-dos picker
  resets to 3.7 Flash (new settings key).

- **Projects Duplicates wait reason** — AI review identities no longer sits
  disabled with no explanation while duplicate groups or identity-review
  status load (or while another Projects action is in flight). An amber
  banner names the wait and shows elapsed time after a few seconds.

- **Identity review Pass 2 email packing** — Each cluster reuses the
  fingerprint source-email snapshot from the start of the run instead of
  waiting on a full registry rebuild per member. Server logs now print pack
  vs LLM time per cluster.

- **Identity review no longer rebuilds the registry after every merge** —
  High-confidence applies still persist merge edges and entity marks
  immediately. The minutes-long fingerprint+mention refresh runs once when
  the run completes, fails, or is cancelled (if the in-process worker is
  already gone). Manual merges from the Projects UI still refresh right
  away. Pass 2 decisions already used a frozen snapshot, so later clusters
  do not depend on a live list.

- **Badge hover popovers** — Inbox and harvest badges no longer open a preview
  the instant the pointer crosses them, and they no longer sit for half a
  second after you leave. The preview waits ~300ms of dwell (so scrolling
  past a dense row does nothing), closes in ~100ms, dismisses immediately on
  scroll, and skips the wait when you move from badge to badge. Click still
  opens the side panel.

### Fixed

- **Floor plan compare matches the crop rectangle** — Cropping a later
  floor (or resizing with overlay off) updated the family plate size and
  the blue overlay, but left already-cropped sibling PDFs at their old
  size. Compare then showed a narrower sheet than crop mode (stairs cut
  off on the right). Saving a crop now rewrites any sibling whose PDF
  drifted, and opening a cropped file regenerates it when it does not
  match the family plate.

- **Full-screen crop zoom chrome and jump** — The crop rectangle border and
  corner handles no longer thicken with zoom; they stay a constant screen
  width so the crop edge can be placed on a line. Wheel zoom no longer
  flashes a PDF reload and then jumps zoom again: while a sharp clip
  re-rasterizes, the editor hides that bitmap so a cleared canvas cannot
  show through the old zoom, then reveals it aligned with the live view.

- **Floor plan crop zoom stays sharp** — Full-screen crop zoom was stretching
  the overview bitmap, so grid lines and crop-handle corners went blurry.
  Zoom now re-renders the visible PDF region at screen resolution after the
  view settles.

- **Floor plan crop hits the visible PDF edge** — Architectural sheets
  with a 90°/270° `/Rotate` flag were cropped against the unrotated
  MediaBox, so the blue rectangle stopped short of the drawing (about
  two-thirds across a landscape sheet). Crop math now follows the page
  as pdf.js draws it. Collapsing a handle to zero width no longer
  throws `Crop size must be greater than zero`.

- **Floor plan crop resize crash** — Dragging a crop-handle past the PDF
  page edge no longer throws `Crop is larger than the PDF page`. The
  rectangle clamps to the sheet so the opposite corner stays put.

- **Thread harvest subject highlights** — Extraction highlights now paint
  entity mentions on the email subject line, not only the authored body.
  Subject-only names such as **Trace** use the same solid / dashed
  unresolved styling as body marks, including when mention rows have no
  unique-body span.

- **Bare vendor nicknames painted as projects** — Thread harvest no longer
  paints a short contractor token such as **trace** as a Project highlight
  (orange wash, PROJECT header, Contractor chip). Firm names go to the
  organization group (fuchsia, Organization header and chip). Unresolved
  org mentions still show their candidate list when one exists. Work names
  such as “riser replacement” stay in the project group.

- **Unminted contractor org hover missing candidates** — A harvest mark
  like subject-line **trace** (project contractor, no pass-3 org card) now
  writes an organization mention and resolves prefix collisions, so the
  hover shows Trace Consulting / Fire / Maintenance as a pick list instead
  of a sparse “from this highlight” card with no suggestions. Opening the
  email self-heals older harvests.

- **Duplicate org names in harvest pick lists** — Unresolved “pick one”
  lists no longer show the same legal name twice when a leftover
  `name:…` entity row sits beside the email-keyed survivor the
  Organizations tab already coalesced.

- **Organizations registry `Can't resolve 'fs'`** — Alias mention counts no
  longer import server-only `field-denials` / `pg` into the client bundle.
  Name-key normalization lives in the existing client-safe org helpers.

- **Local app freeze during fingerprint rebuild** — Project identity matching
  no longer runs Levenshtein against every harvest card × every review policy
  (that blocked the Node event loop for ~5 minutes, so Contacts, Inbox, and
  identity-review polls all stalled). Rebuilds yield to the event loop, local
  `DISABLE_BACKGROUND_WORKERS=true` skips startup warmup, and Duplicates
  progress polls no longer stack overlapping requests.

- **Duplicates “Unauthorized” banner during AI review** — Progress polling no
  longer treats a busy database as a logout. Session lookup failures return 503
  instead of 401, silent polls do not paint a red error, and a recovered poll
  clears the banner. Previously one stalled `/api/projects/identity-review`
  request left “Unauthorized” on the tab while the run kept going.

- **Entities → Projects 5-minute hang** — Switching from Inbox/emails onto
  the Projects registry no longer waits on a full fingerprint rebuild (logs
  showed 4–6 minutes parsing every pass-3 JSON blob). The page peeks the
  in-memory cache and renders immediately; harvest writes mark the list stale
  instead of dropping it; source-email counts come from thread merges like
  Organizations. A rebuild still runs in the background and on server start.

- **Inbox Re-harvest C+P hang** — Project pass-3/4 persist no longer rebuilds
  the entire project registry after every email. Mentions resolve against the
  current `project_entities`; use Process pending project merges when new
  cards need minting. A 25-thread selection was sitting on “Extracting…” for
  20+ minutes because each pass-3 save synced all 706 projects.

- **Projects Mentions tab spinner** — Empty `project_mentions` no longer sits on
  “Loading mentions…” indefinitely. The queue skips the email-body join when the
  status count is 0, truncates snippet text instead of pulling full bodies, and
  the browser fetch aborts after 20s. Header counts load with the Projects page.

### Added

- **Project and contact mention dashboards** — Entities → Projects has a
  Mentions tab (unresolved / provisional / confirmed) with raw name,
  contractor, year, minted badge, linked project, and resolution-reason
  codes. Process pending project merges re-syncs `project_entities` and
  re-runs the matcher from the browser. Contact cards and the Mentions
  inspection list show `role_phrase` and the stored `resolution_reason`.
  Re-harvest thread (email panel, mention groups, and Inbox **Re-harvest
  C+P**) runs contact and project passes 1–4 on historical mail so
  resolution can be tested without SQL.

- **Project mention staging** — Pass-3 project fingerprint cards are written to
  `project_mentions` (name, contractor, year, source email) before the minting
  gate. Cards that fail the gate stay unresolved instead of disappearing;
  minted cards attach to `project_entities` only when the identity key uniquely
  matches. Contacts gain a `role_phrase` on mentions (solicitor, property
  manager, …) derived from job title.

- **Rosetta Stone mention resolve** — When a strong contact identity lands,
  unresolved mentions are re-run through the existing decision function,
  bounded by the ingest thread, `first_org_key`, and email. First+org stays
  provisional and still retracts; there is no bulk `UPDATE` by blocking key.

- **Project mention lexical resolve** — Unresolved project mentions shortlist
  up to five `project_entities` rows from an in-memory search document (name,
  aliases, contractor, year, location). `decideProjectMentionResolution`
  confirms a unique identity key or unique exact/alias name when years overlap,
  attaches a unique work-name match provisionally, and leaves ambiguous or
  year-mismatched mentions unresolved. Aliases fold onto `project_entities` at
  fingerprint sync so “magnet” can hit Maglock. Contractor-as-name cards cannot
  attach through the contractor field.

- **Working-list click-in** — Click an email-harvested Global To-Do row to open
  the source thread with the extracting sentence marked in yellow. The panel
  header repeats the task being verified; **Mark complete** stays on the row.

- **Board-report scan review** — After a management-report scan, the unmatched
  topic count and “waiting on markdown” count on Entities → Projects are
  clickable. Unmatched headings group by work name with report counts; skipped
  packages list filename, date, pages, and conversion status (link to the
  source email). Re-match topics with AI reuses the already-extracted headings
  (no PDF re-scan) and maps them onto registry cards by name, aliases, year,
  contractor, location, and equipment — so Maglock matches “magnet” /
  electromagnetic locking devices instead of a 0.72 fuzzy threshold.

- **Board-report project salience** — Entities → Projects can scan the monthly
  management reports (and the management-report section of board packages) the
  PM sends before meetings. Extracted topics are matched onto the registry;
  matching cards get an emerald **Board · N** badge, a “In a management report”
  filter, and a Board-reports sort. Standalone 2021–2023 reports are already
  converted to markdown; later 100+ page packages are skipped until parsed,
  then sliced so appendices do not mint every invoice line as a project.
  Topic matching is exact work-name identity plus an AI pass over card
  metadata, not fuzzy string similarity.

- **AI project identity review** — Entities → Projects → Duplicates can run a
  two-pass review over the registry. Pass 1 clusters cards by type of work
  (MagLock variants together, kitchen-stack years together). Pass 2 reads the
  attributed emails and decides one spanning capital job vs yearly campaigns vs
  actually separate. High-confidence decisions auto-merge; medium and low stay
  as proposed groups. The review also stores a span / recurring-year policy so
  later harvests attach to the survivor instead of minting another MagLock card.

### Fixed

- **To-do source-quote highlights** — Stored quotes that copied a paragraph or
  the whole unique body no longer wash the email. Display-time matching clips
  to the extracting sentence (skipping greetings), focused harvest marks paint
  amber instead of the group color, and future harvests ask for one verbatim
  sentence. No re-extract required. Opening a Working row scrolls the source
  panel to that sentence instead of centering the whole message (which landed
  in quoted history). Expanding another email in that thread no longer jumps
  the scroll back to the original quote. Sibling harvested to-dos in the
  thread paint lime (hover for assignee / task); the clicked one stays amber.

### Changed

- **Project phase and year badges** — Entities → Projects maps extracted
  phase prose onto seven lifecycle statuses (planning, tender, awarded, in
  progress, complete, on hold, cancelled) and drops work-package labels like
  Phase 1. Year is an inclusive calendar range (`2024` or `2024–2026`):
  “this year” / “next year” resolve to a year, durations like `3-year` are
  omitted, and project identity uses the range. Existing harvested cards
  remap on load, so the badge legend stays a closed set instead of every
  raw extractor string.

- **One Postgres for local and production** — `npm run dev` now uses the same
  Supabase session-pooler URI Coolify uses. Compose Postgres on
  `localhost:5433` is rollback-only so merges, harvest, and field moves
  cannot split across two databases again.

- **Projects list metadata badges** — Scope, phase, and year on Entities → Projects
  render as subtle tinted badges (sky for scope, amber for phase, violet for year)
  so each dimension is easy to scan without loud color.

- **Projects list filter popover** — Project filters open in a dropdown from the
  toolbar filter icon (same interaction model as sort) instead of expanding an
  inline panel that steals vertical space from the list. Menus portal to
  `document.body` with fixed positioning so they are not clipped by the
  scrollable list column.

- **Projects list badge legend** — A legend button beside the filter control
  opens a popover that explains scope, phase, and year badge colors and lists
  the values seen in the current registry.

### Added

- **Entities list pagination** — Organizations, Projects, and Equipment on
  Entities Registry paginate at 100 rows, same as Contacts → People. The
  header counts are the true unique totals, not a sliced list length.
  Duplicates, mention charts, and fingerprint sync no longer stop at 500
  or 2000 rows.

- **Project merge-QA filters** — Entities → Projects can sort by mentions,
  name, year, phase, or metadata completeness, and filter by scope, year,
  phase, contractor / location / equipment presence, and incomplete vs
  complete cards. Search also matches aliases, contractor, location, and
  equipment.

- **Business plan grounded in this building** — The super-admin Business
  Plan still sells the multi-building thesis, but ROI dollars now come
  from TSCC 2517’s latest operating-budget GL (same source as Budget &
  Financials). Cleaning and security show real spend with $0 hard
  savings; PM is 10–20% of actual management fees; equipment +
  preventative stay inside 15–35% of repairs/HVAC/elevator spend;
  reserve-study value stays consulting dollars, not a cut to the
  contribution. The size slider defaults to 333 units and scales from
  this building, not a generic 250-unit memo.

- **Budget section plots** — Clicking a category header (Administration,
  Utilities, …) plots the sum of every GL line in that section. Works on
  the Plots list and the Line items table; the detail panel titles the
  chart with the section name and the line-item count.

- **Budget line-item linearity** — The Line items table has a **Fit**
  column between the account name and the first fiscal year. It is
  `1 − RMSE / mean(|amount|)` of a straight-line fit: how tightly the
  plotted points hug a line, as a share of the typical dollar amount.
  Budgeted and actual are scored separately and the worse one is shown.
  100% is a perfect line, including a nearly-flat fee; the cell is blank
  below three years. Teal / amber / rose mark high, moderate, and poor
  fits. (R² is not used — it treats a flat $8k levy as “noisy” and a
  rising staircase as “linear.”)

- **Building budget page** — Budget & Financials lists emailed TSCC 2517
  operating-budget packages by fiscal year. Click a file to preview it. Parsed
  PDF tables populate GL line items with year-over-year charts (each account
  and revenue vs expenditures) plus a pivot table. Later packages supply
  prior-year actuals from their projected column.

### Changed

- **Business plan formulas** — Rate × spend equations on ROI and Budget
  impact are large enough to read. The percentage is an “assumption”
  chip (the Conservative / Full potential toggle) with a short note on
  where that rate comes from in the value memo and what justifies it.

- **Business plan number provenance** — ROI model and Budget impact now
  show the arithmetic for every figure (rate × this building’s GL spend
  × unit scale) plus a short note on which books and which assumption
  produced it. The formulas stay visible; only the GL line list and
  operating story remain behind the category toggle.

- **Budget document badges** — Documents tab uses a PDF wordmark icon and
  an Excel X icon. Spreadsheets were previously tagged as Word because the
  Excel MIME type contains “document.” Parsed files show **extracted**; the
  highest-ranked file for that year shows **primary**.

- **Budget line-item detail** — Clicking a Line items row opens a chart
  panel that pushes the table left. Clicking another row updates the panel
  in one click. The close control on the panel’s top-left restores the
  full-width table.

- **Budget & financials tabs** — Plots, documents, and line items are now
  separate tabs instead of one long scroll. Plots is the default view.
  Heading and tabs stay fixed; only the tab body scrolls. Line items uses
  a separate header row and a scrolling body so the scrollbar does not
  sit on the header; the name column stays pinned when scrolling
  sideways. Plots shows an all-items year-over-year chart on top; click a
  GL line on the right to populate the budgeted vs actual chart on the
  left.

- **Project minting gate** — Entities → Projects no longer treats contractor-only
  fingerprints as projects. A card must have a work-name that is not the
  contractor and not an organization identity. Display titles no longer fall
  back to contractor or location. Pass 4 now applies a thread-level boundary
  test (multi-step, non-routine, discrete lifecycle) so vendor names, complaint
  threads with no named job, and missed service calls stay out. Source-email
  evidence lists only messages whose pass-3 card matches that identity or whose
  body names the work, and hides signature stubs. Existing junk cards disappear
  on the next project-list rebuild; named-but-routine leftovers still need a
  pass-4 re-extract.

### Added

- **Project scope** — `project_entities.scope` (`building`, `multi_unit`,
  `unit`, `unknown`) is extracted with each fingerprint and shown as a filter
  on Entities → Projects. When the model omits it, scope is derived from
  location (named units vs building common elements).

### Fixed

- **Merged org cards forking on rebuild** — After a manual merge, stripping
  denied fields recomputed `email:…` identity keys and resurrected absorbed
  harvest aliases (two Studio Richmond rows sharing the same mention count).
  Rebuild now resolves through the merge map and keeps merge survivors on
  their surviving key.

- **Project “source emails” panel crashed** — Clicking the source-email count
  hit an in-memory project list built before that index existed and showed
  “Could not load evidence.” A stale cache is now rebuilt, and the lookup
  no longer throws.

- **Page switches taking 30+ seconds** — Navigating no longer rebuilds every
  organization and project fingerprint (all merge JSON plus pass-3 email
  sightings) on each request. Those lists stay in memory after the first
  rebuild (background refresh every 30 minutes) so sidebar tab switches are
  instant. Contacts header counts use `COUNT(*)` instead of downloading the
  merge, ingest, and AI-decision tables. Sidebar remounts no longer restart
  pending-merge ingest or mailbox coalesce. Entities loads only the visible
  tab, and the people list uses stored mention weights instead of re-scanning
  email bodies. Local Internal Server Error from a corrupted Next.js cache is
  cleared by deleting `.next` and restarting the dev server.

### Added

- **Sidebar click loading overlay** — Clicking a destination in the left nav
  immediately blurs the page content and shows a spinner until the new page
  is ready, so a slow switch still feels like it registered.

- **Project field evidence** — Click a project name, alias, year, phase,
  contractor, location, or equipment to open emails where that value was
  extracted. Click **N source emails** to list every message attributed to
  that project card (works when Name is empty and the title is a contractor).
  Expand a row to read the message with project fields highlighted.

- **Business Plan (super admin)** — System Admin sidebar includes a Business
  Plan page built from `.doc/business-ase-and-value-proposition.md`. Hero
  savings figures, conservative vs full-potential scenarios, a unit/price
  scaler for ROI, expandable budget categories, and a network-effects view
  replace a raw markdown dump.

- **Organization field evidence + move to contacts** — Click an organization
  name, alias, email, phone, or website to open a side panel of the emails
  where that value was extracted as an org field (same pattern as Contacts).
  The move control can send an alias, email, or phone onto a person card, so
  a last name like Gartenburg can leave the corporation and land on the
  contact. If it already is that person’s last or first name, it is only
  removed from the organization.

- **Shared mailboxes** — Entities has a Shared mailboxes tab for addresses
  occupied by more than one contact. The left list is those email addresses;
  the detail view shows each associated person on a shared occupancy timeline
  (closed ranges and “present” for the current occupant).

- **Contact mentions vs people** — Sparse first-name harvests (`Dan`, `Dan from XYZ`)
  land in `contact_mentions` instead of minting People cards. Pass 3 keeps
  `raw_company`. A discrete resolver attaches mentions when identity is unique
  (email/phone, thread participant, unique first+last, full name in the email
  subject, or a well-known first+org match) and retracts provisional links if a
  second Dan at that org appears. Convert existing stubs from **Contacts →
  Convert stubs** (preview, then apply). CLI `npm run backfill:contact-mentions`
  still works.

- **Contacts Mentions tab** — Unresolved harvests are grouped by first+org
  (not listed as People). Open the source email in the side panel, attach a
  group to an existing person, or leave it unresolved. Provisional and
  thread-participant samples are available for review. Header counts show
  confirmed / provisional / unresolved.

- **Mentions Full names queue** — Unresolved harvests that already have a
  first and last name no longer sit in the first-name pile (the “John”
  bucket). They have their own Full names list so leftover ingest leaks can
  be reviewed. Create a People card from the checked mentions, or attach to
  someone who already exists. The matcher also treats a trailing middle
  initial (`John P.`) as the same given name as `John`.

- **How mentions match** — Knowledge → Entities → How mentions match is a
  plain-language rulebook for turning email name sightings into People cards,
  with examples (including Haider / Haider Mukadam) and a checklist for when
  a mention looks wrong.

- **Extract markdown Storage I/O** — A disk miss for assembled `.md`,
  Docling, or vision artifacts downloads from the private
  `extract-artifacts` bucket and writes the local cache. New Docling and
  vision writes go to disk and Storage so Coolify and local share the paid
  extract corpus. Original PDFs still stay on disk and re-fetch from Gmail.

- **Extract markdown in Supabase Storage** — Assembled `.md`, Docling, and
  vision artifacts (~257 MB) live in a private `extract-artifacts` bucket.
  Original PDFs and video stay on local/Coolify disk and can be re-fetched
  from Gmail.

- **Move org fields** — On Entities → Organizations, the arrow next to an
  alias, email, phone, or website moves that value to another organization
  without merging the cards. Example: `Studio 1 Property Management` can leave
  the management-office card and land on ICC. Sever (×) still drops a value
  without assigning it elsewhere.

### Changed

- **Moved org aliases take their emails** — Moving an organization alias onto
  another card now re-buckets source emails harvested under that name (the
  name that had been folded into the source card). Already-moved aliases are
  not lost: harvest still has the original names, and the move rows are the
  record of where each alias went. Emails that also harvested the source
  card’s remaining name stay on both cards. Leftover mentions of the source
  primary name stay put until you decide where those go.

- **Moved org email keeps the name card** — Moving an organization’s identity
  email to another card no longer drops the source from the list. The name
  card stays visible with its remaining mentions; sparse mailbox-only harvest
  stubs are cleaned up instead of leaving a ghost `studiopm@…` row.

- **Org source-email counts match harvest names** — Sidebar “source email”
  counts now follow pass-3 per-message harvest names (and moved mailboxes), not
  whole-thread buckets. After moving aliases or an email address off a card,
  the source count is only messages extracted under that card’s remaining
  primary name; click **Name** to open the same set in the evidence panel.

- **Identity email move keeps sibling mailboxes** — Moving one mailbox off a
  card that was keyed by `studiopm@…` no longer drops the other addresses that
  had been co-bucketed on that card. They stay on the name card (and are pinned
  on move going forward).

- **Mentions review cards** — Each mention shows about 100 characters of
  email text before and after the name, with the same yellow quote mark
  used in the email side panel. Open email is an eye icon on the right of
  the card. Check the mentions that belong to one person, then attach via
  a same-name badge or the search box; unchecked rows stay unresolved. A
  header checkbox selects all or none, and shows a dash when the list is
  mixed.

- **Compose Postgres URL** — The app service no longer hardcodes
  `COND_BOARD_POSTGRES_URL` to the compose `db`. Local Docker still
  defaults to that in the entrypoint. Coolify can point at Supabase
  without the compose file overwriting it.

### Fixed

- **Org identity email move — co-bucket mailboxes and source counts** — Moving
  one mailbox off an `email:…` org card no longer wipes sibling ICC addresses
  from the named survivor (e.g. Studio on Richmond Management Office). Residual
  collection now finds mailboxes on any pass-4 card that included the moved
  address, not only cards keyed on that exact mailbox. Pinned mailboxes are kept
  for the Email field only; they no longer inflate source-email counts across
  every message that mentions that address. Moving a sibling mailbox off the
  name card afterward no longer snaps back on refresh.

- **Teal unique overlay vs mentions** — Teal tried to locate unique text
  inside HTML and drew nothing when that failed (Outlook replies), while
  mentions still searched the unique string. The overlay now paints that
  same unique body mentions use: in place when it lines up, otherwise as a
  teal unique block above the full message. Harvest uses that same unique
  source.

- **Mentions copied onto the wrong emails in a thread** — Fingerprint ingest
  used every email in the thread as evidence for every merged person, and
  Convert stubs then wrote first-name mentions onto those messages. A Judy
  sighting on one reply became a Judy mention on twenty. Ingest now keeps
  only emails whose pass-3 card (or visible name/mailbox) belongs to that
  person. Convert stubs skips evidence emails that do not contain the name
  and drops existing mentions that are not on their source email.

- **Mentions flagged from quoted reply history** — Presence still treated the
  full stored body as “this email,” so a name in an earlier message was
  counted again on later replies that only quoted it (Judy on the Sharing
  request thread). Mentions now use each message’s unique authored text
  (plus headers). Open email highlights the name there, not in the quoted
  remainder. Convert stubs drops leftovers that fail that check.

- **Convert stubs looked finished when it did nothing** — After harvest and
  stubs were already done, Confirm was labeled “OK” and closed immediately
  without re-running matching. It now keeps the dialog open, re-runs the
  matcher on unresolved mentions, and shows confirmed / provisional /
  still-unresolved counts when it finishes.

- **Mentions “Open email” skipped the side panel** — The Mentions tab opened
  `/knowledge/emails/…` in a new tab (extract-lab first, body below). It now
  uses the same source-email side panel as to-dos and equipment, with the
  mention name highlighted.

- **First-name mentions ignored an obvious full name** — `Haider` stayed
  unresolved even when the harvest already had last name Mukadam, or the
  subject was `Re: Haider Mukadam - Condominium Manager`. The resolver now
  confirms a unique first+last, or a unique full name already in the subject,
  without the 8-email first-name prior.

- **Contacts sweep/backfill white-screen** — A failed or timed-out
  registry POST returned HTML, and the People page crashed on
  `res.json()`. Sweep, coalesce, and pending-merge ingest now return JSON
  errors, and the client shows the message instead of an application
  error overlay.

- **Contacts auto-coalesce on shared mailboxes** — Opening People no
  longer picks one mailbox-wide survivor (Bonnie on `studiopm@`) and then
  leaves every other identity untouched. Same-human stubs such as
  `Haider` / `Haider M` now cluster into Haider Mukadam even when a
  former occupant has a higher mention count. Zero-mention rows were
  those unmerged stubs, not a display bug.

- **Shared-mailbox occupancy and Telegram holds** — Role addresses like
  `studiopm@` were closed at the last thread date (so the current manager
  never showed “present”), sweep kept the highest-mention former occupant
  open, and harvest posted one Ambiguous contact message per mention —
  sometimes proposing Bonnie Kafi and sometimes Haider Mukadam for the
  same mailbox. Occupancy now keeps only the latest-evidence person
  open-ended, nameless cards attach to that occupant, named cards that
  uniquely match one human auto-apply, and pending Telegram reviews
  collapse to one item per mailbox identity. Sweep rebuilds ranges from
  named evidence instead of asking the model who has more mentions.
  Opening Contacts also repairs occupancy (same pass as stub coalesce).

- **Analysis Lab went blank on production** — `/admin/analysis` waited on
  a cost summary that ran one query per extraction source (~14k). The hub
  now renders immediately, and the summary uses a single aggregate query.

- **Gmail history cursor stuck on deleted messages** — History can list a
  message that Gmail then 404s (`Requested entity was not found`). Those
  are skipped so the cursor can advance and later mail still imports.

- **Coolify build OOM during trace collection** — `next build` compiled but
  died on "Collecting build traces". Docker builds now cap Next workers to
  one CPU, enable webpack memory optimizations, skip source maps, and use a
  3 GB heap so the process stays under the Services host limit.

- **Production crash after trace excludes** — Over-broad
  `outputFileTracingExcludes` stripped runtime files from the standalone
  image and the app crash-looped ("no available server"). Excludes removed;
  pdfjs worker is explicitly included instead.

- **Hosted Drizzle journal after dump restore** — Startup migrate no longer
  dies on `0002_worthless_talon` when `password_reset_tokens` already exists.
  That migration is idempotent, duplicate-object errors stamp and continue,
  and the hosted database is marked through `0038` so later journal rows are
  not skipped on every restart.

- **Telegram getUpdates conflict** — Local `DISABLE_BACKGROUND_WORKERS=true`
  no longer long-polls the bot, so production can keep Telegram HITL. Prefer
  `TELEGRAM_WEBHOOK_URL` + `TELEGRAM_WEBHOOK_SECRET` on Coolify so a local
  full-stack run cannot steal updates.

- **Coolify production Docker build OOM** — `next build` type-checking now
  skips in the Docker image (`SKIP_TYPECHECK=1`) and the Node heap is 4 GB,
  so the larger extraction codebase can deploy on the Services host.

- **Server pdfjs DOM polyfill** — Instrumentation now stubs `DOMMatrix` /
  `ImageData` / `Path2D` before importing Gmail/pdf workers so production
  Node startup does not abort the scheduler.

### Added

- **Telegram digest after harvest** — After ingest + harvest-missing (cron
  and Sync now), ambiguous contact identity holds and new affiliation
  `needs_review` rows are posted to a Telegram chat with Approve / Deny.
  High-confidence contact applies stay silent. Historical Stage 2B stays
  in the Entities UI. Set `TELEGRAM_BOT_TOKEN` on the server; each user
  stores their Telegram chat ID in Profile and can send a test message.
  The bot cannot DM you until you open it and tap Start; `/start` replies
  with your chat ID. Profile also shows account email (read-only) and
  editable first / last name.

- **Harvest after Gmail sync** — Cron and Sync now can run harvest-missing
  after ingest (contacts, organizations, events, to-dos on emails that do
  not already have that concept). Email settings has **Harvest after sync**,
  off by default so the historical to-do bulk can finish first. A running
  inbox bulk extract skips the drip so it is not cancelled.

- **Global To-Dos Archive** — Harvests older than 120 days are on an Archive
  scope next to Working. Archive uses the same Due / Open-ended / Done tabs,
  so historical asks that thread close-out could not resolve stay open, and
  items the thread already answered sit on Done. Working is still the live
  board checklist.

### Changed

- **Global To-Dos sort** — Added a Sort by dropdown (reverse chronological,
  chronological, due date, assignee). Default is reverse chronological so the
  newest source emails appear first.

- **Global To-Dos Archive pagination** — Archive Due / Open-ended / Done tabs
  now show 50 items per page with Previous / Next controls, so long historical
  lists stay scannable.

- **Archive thread close-out** — Persist used to skip LLM reconcile on stale
  (pre-window) harvests, so every old ask stayed open. Close-out now runs on
  those threads too, including “send calendar invite” tasks when a meeting
  invite exists anywhere in the corpus. Re-run with
  `npm run closeout:archive-todos`.

### Fixed

- **Merge contact search looks across the whole People registry** — The
  merge-into dropdown only searched the 100 contacts on the current People
  page, in list order. Nameless email stubs sort first under Name A→Z, so
  typing “john” while merging `jwilson@…` showed “A. Johnson” / “Adam
  Johnson” from that page and omitted “John Wilson” (later pages). Merge
  now loads the full registry for the picker and ranks given-name matches
  above Johnson-style substring hits.

- **Delete imported mail for one allowlist sender** — Sender allowlist rows
  with imported mail now have **Delete imported**, separate from Remove.
  That deletes threads that exist only because of that From address, plus
  harvest extractions from those emails. Gmail is unchanged. Threads that
  also include someone still on the allowlist are kept. If the sender is
  still saved, they are unsaved in the same confirmed step so sync does not
  bring the mail back.

- **To-do harvest close-out actually runs** — After extracting to-dos from
  email, the app is supposed to collapse duplicates in the thread and mark
  items done when a later reply answers them. Two wiring bugs meant that
  never happened on harvest: duplicate-matching was sent to Gemini under the
  DeepSeek harvest model name (Gemini 404’d and every item was inserted),
  and the close-out pass only looked at emails marked fully analyzed, which
  harvest never sets. Harvest close-out now uses the harvest model (DeepSeek
  or Gemini) on the matching provider, sees harvested messages via extraction
  sources, and treats an empty `insert_items` list as “insert nothing”
  instead of reinserting the whole batch. Extraction and close-out prompts
  also skip status-report leftovers, resident FYIs, and follow-up pings that
  restated an ask already on the list.

### Changed

- **Build-out do-next playbook** — The Dev Tools Build-out popup leads with
  a numbered sequence (body to-dos now, Stage 2B in parallel, then ongoing
  harvest-missing on the existing Gmail ingest cron, Telegram HITL for
  ambiguous identity, vision blocked on the Gemini spend cap, then
  attachment harvest, then later layers). Stage cards stay an inventory.
  Vision backfill and harvest-from-markdown are separate backlog items.
  Coverage numbers in the playbook are a dated snapshot in
  `lib/buildout/progress.ts`; live counts stay on the extraction calendar.

- **Collapsible left sidebar** — Top tabs and the second-row section
  pills are replaced by a 240px tree sidebar. Collapse it to a 64px icon
  rail; hovering a section with sub-pages opens a floating drawer over
  the page (no layout shift). On small screens a hamburger slide-over
  holds the same tree. Dev Tools and System Admin stay amber-tinted at
  the bottom. Knowledge → Entities links to Contacts, Equipment, and
  Organizations via `?tab=`.

- **Global To-Dos row layout** — Harvest type stays as a left chip; the
  source date sits in a fixed right-hand column with an eye button (opens
  the thread) and **Mark complete**, so dates line up across rows. A
  filter control above the list can narrow by harvest type, assignee,
  source date range, overdue items, and description text.

- **Global To-Dos is a flat list** — Items are no longer grouped under
  assignee cards like “Bonnie Kafi — Email”. Each row is the task, with
  chips for who it’s assigned to, where it came from, and any due date.
  Tabs split the list into **Due** (has a deadline, soonest first;
  overdue in red), **Open-ended** (no deadline), and **Done**. The page
  opens on Due when anything is dated, otherwise Open-ended. Completed
  items live on Done instead of a “Show completed” checkbox.


- **One working to-do list** — Global To-Dos is the board checklist: meeting
  merges, manual adds, and open email harvests from the last 120 days.
  Overview links there instead of showing a second list. Meeting merge no
  longer deletes email or manual rows. Harvest JSON still lives on the email.

- **Thread harvest badges** — Contact, organization, event, and to-do chips
  on the email list show how many items that harvest found, then the cost.

- **Extraction calendar Show missing counts** — Header badges keep one
  `N / eligible` figure. Extracted shows extracted / eligible; Show missing
  switches the numerator to the gap and turns that figure red. The extra
  “229 missing” label is gone so the last badge no longer wraps onto a
  second line.

- **Extraction calendar missing shades** — Unfinished attachment work is
  still amber, but the shade is how much is left: yellow for a partial gap,
  dark burgundy when nothing on that day is extracted. The footer legend
  now shows that ramp (same idea as the Extracted legend).

- **Extraction calendar Show missing** — That toggle is a filter, not a
  new color. Completed coverage is hidden; unfinished lanes keep their
  own colors (amber attachments, sky events, and so on). A day with both
  missing files and missing events shows two stripes. Blank means
  extracted or nothing to extract that day.

- **Extraction calendar lanes** — The year grid no longer has an Email body
  stripe or badge. Body text arrives with ingest; the calendar only tracks
  extractions on top of that (attachments, contacts, organizations, events,
  to-dos). Equipment stays an empty placeholder lane.

- **Calendar event colors by type** — Month chips, list badges, and the event
  dialog now color meetings, inspections, maintenance, and deadlines
  separately. Cancel and reschedule stay harvest-only (they move or hide a
  row; they are not calendar categories). A compact legend sits next to the
  month/week toggle.

- **Event harvest calendar apply order** — Bulk event extract saves harvest
  JSON per thread, then applies calendar rows once at the end in email
  `receivedAt` order. After every persist (inbox batches included), cancel
  and reschedule mutations are replayed across all harvests for that model
  so a Teams cancel in a newer thread still closes an invite harvested
  earlier or later. Duplicate same-day meetings left by a reschedule-first
  persist are collapsed. The calendar may not update until a bulk run
  finishes.

### Added

- **Global To-Dos source email** — Email-harvested items show the date of
  the source email on the right of each row. Open-ended (and Due ties)
  sort by that date, oldest first. An eye button opens the source thread
  with only that email expanded and the to-do quote highlighted.

- **Build-out progress popup** — Admin sidebar (Dev Tools audience, not
  System Admin) has a **Build-out** button. It opens a status board of harvest
  stages 1–5 plus 2B, Open Knowledge Format (deferred), attachment harvest,
  entity profiles, email reply drafts, the 3D twin specs, and concept
  auto-promote. Statuses are curated in `lib/buildout/progress.ts`.

- **Entity popovers on Global To-Dos** — Names of stored people, organizations,
  and equipment, plus dated calendar events, in a to-do heading or description
  are highlighted. Hover shows that entity’s card. “June 30 board meeting”
  links the June 30 calendar row for the most recent past year when the
  phrase omits the year (so 2025 and 2026 annual meetings do not stack). A
  bare “board meeting” does not link. Click-through to a full profile is not
  wired yet except a calendar link on event cards.

- **Dedicated to-do harvest (Stage 4)** — Inbox and bulk extract can run a
  one-pass harvest of unresolved email asks (assignee as free text, optional
  firm deadline, source quote). Harvest JSON is stored per email. Persist
  writes every year of asks into `extracted_action_items`: recent mail
  (last 120 days) stays `open` on the dashboard and Insights lists; older
  harvests are `stale` archive, not working-list clutter. Completing an item
  still sets `completed`. Meeting `/operations/todos` stay a separate list.
  Soft deadlines stay off the calendar.

- **Extraction calendar** — The knowledge emails toolbar opens a GitHub-style
  year grid of received days. Each day is a stack of concept stripes
  (attachments, contacts, organizations, events, to-dos, plus an empty
  equipment lane). Color is coverage for that day; hover shows counts. **Show
  missing** is a filter: same lane colors, only unfinished eligible work.
  Blank means that lane is done or had nothing to extract. Badges show
  extracted / eligible counts instead of a bare percent.

- **Dedicated event harvest (Stage 3 / 2A)** — Inbox and bulk extract can
  run a one-pass calendar harvest (meetings, cancellations, reschedules,
  hard deadlines, inspections, dated maintenance as free text). Harvest JSON
  is stored per email; persist reuses the Google Calendar lifecycle (add /
  move / hide on cancel) and does not create equipment assets or to-dos.

- **Calendar event lifecycle (Stage 3 foundation)** — Cancellations pull a
  meeting off the calendar instead of leaving a cancelled stub. A same-email
  reschedule moves the existing event (stable id). A Microsoft Teams cancel
  followed by a later new invite closes the old event and adds a new one.
  Dated inspections now appear on the calendar. Event rows store
  `source_quote`. Action items have a `related_event_id` stub so Stage 4
  to-dos (for example AGM prep) can hang off an event without landing on
  the calendar. Dated maintenance stays free-text and no longer creates
  equipment assets.

- **Retry remaining pages** — On a finished backfill that still has uncached
  Docling pages or failed vision pages, starts a new full-corpus run over that
  leftover work (pages insert in place; already-good pages are not redone).

### Fixed

- **Extraction calendar dialog width** — The year grid now sets the modal
  width. Badge and legend rows wrap inside that width, so **Show missing**
  no longer stretches empty space past the year list.

- **Calendar list mode crash** — Harvested time ranges such as `09:00-17:00`
  were stored as invalid ISO (`…T09:00-17:00:00`). Switching to list view
  threw `RangeError: Invalid time value`. List rows now show the start
  clock; new harvests keep only `HH:MM`.

- **Extraction backfill error split** — Completed runs now show Docling pages
  not completed separately from vision failures, grouped by cause (Gemini
  spending cap, fetch errors, encrypted PDFs, truncated output). The previous
  list was a stale alphabetical slice, so thousands of Gemini 429s looked like
  one encrypted document.

- **Gemini vision 429 split** — Monthly spend cap, prepaid credits depleted,
  and RPM rate limits are no longer lumped together. Only cap/credits abort
  remaining vision work (pages stay pending). Rate limits back off and keep
  going. A retry run requeues leftover `failed` 429 rows at start so a skipped
  corpus no longer looks like thousands of new failures.

- **Gemini vision spend display** — Page-vision cost now uses Gemini 2.5 Flash
  list prices ($0.30 input / $2.50 output per 1M, including thinking tokens)
  and records cost on truncated/degenerate calls that Google already billed.

- **Gemini monthly spending cap** — A 429 / "exceeded its monthly spending cap"
  no longer burns three attempts per page and marks them failed. Those pages
  stay pending; the run stops claiming more vision work and continues Docling.
  Raise the cap in AI Studio, then use **Retry remaining pages**.

- **Vision page retry insertion** — Re-extracted vision pages splice back in
  page-number order among Docling/vision markers, instead of appending at the
  end of the attachment Markdown.

- **Vision requeue attempts** — Retrying a failed page resets `vision_attempts`
  so encrypted-PDF and quota recoveries get a full three tries.

- **Extraction backfill modal layout** — Title and action buttons stay
  pinned. One scrollbar covers the body (live ETA, IBM key bars, past
  runs) so the spend panel is no longer clipped by the footer.

- **Extraction backfill live ETA** — Rate and remaining-time now use only
  the current stint (pages finished since this start or resume ÷ stint
  duration), not lifetime totals. The live panel shows this-stint duration,
  page count, and ETA; it waits until the first page of the stint finishes.

- **Extraction backfill live progress** — IBM spend bars and run counters
  refresh every ~1.5s while a run is open. Poll no longer loads every
  vision error for the planned corpus on each tick (that query was stalling
  the UI until a full page refresh).

- **Extraction backfill terminal noise** — Vision page slicing no longer
  dumps pdf-lib `Trying to parse invalid object` / `Invalid object ref`
  warnings for every recovered xref on malformed condo PDFs. Parse still
  recovers; owner-restricted PDFs load the same way page-count already did.

### Changed

- **Thread harvest side panel** — Clicking a Contact, Organizations, or Events
  badge on `/emails` opens one thread panel. Emails are listed oldest → newest;
  each body shows every harvest at once. Color is the harvest group (violet
  contacts, fuchsia organizations, sky events). A type icon sits at the start
  of each mark (phone, person, wrench, calendar, …). Event quotes are the
  outer wash; names/phones nest inside when they overlap.

- **Events harvest badge** — Hovering the inbox Events cost badge opens a
  styled popover listing each extracted meeting, cancellation, reschedule,
  deadline, inspection, and maintenance row with a type badge. Harvest cost
  is in the popover header. Clicking the badge (or a row in the popover)
  opens the thread harvest panel on that email, with all harvest types
  highlighted (not only the one event quote).

- **Extraction backfill corpus counts** — The Run tab now shows total, done,
  and remaining pages for Docling and Gemini instead of labeling the whole
  text-route corpus as “pending.” Vision remaining splits pending vs failed.

- **Docling backend default** — Extraction backfill now defaults to
  IBM watsonx (dropdown + new-run API). Local sidecar remains selectable.

- **Extraction backfill modal scroll** — Header, mode/docs/backend
  controls, live status, and footer stay pinned. Only the Past runs list
  scrolls when history is long.

- **Navigation information architecture** — Replaced the 13-item flat top
  nav with five board-facing sections (Overview, Operations, Knowledge,
  Building, Insights) plus role-gated Dev Tools and System Admin. Each
  section uses a persistent SubNav. Routes moved under `/operations/*`,
  `/knowledge/*`, `/building/{overview,maintenance,budget}`,
  `/insights/{queue,analytics,audit}`, `/admin/{concepts,analysis,notes}`,
  and `/admin/system/{users,settings}`. Legacy paths redirect. Insights
  review queue is separate from Knowledge entity registries; budget lives
  under Building; admin pages show an Admin Workspace banner.

- **Extraction backfill sample selection** — Limited runs (10 / 50 / custom N)
  now pick a size-stratified sample across small/medium/large pending docs so
  page totals track the corpus average. Previously preferred fattest (and
  mixed) docs first, which made small test runs take many hours.

- **IBM extraction backfill throughput** — IBM/vision backfill now runs a
  document pool (default 4, `DOCLING_IBM_CONCURRENCY`) instead of one convert
  at a time. Docling and vision for the same doc overlap; IBM page ranges and
  Gemini vision pages share concurrency caps. Sidecar Docling stays serial.

- **Extraction backfill error details** — Vision progress now counts unique
  terminal page failures (not retry attempts or failed docs). The modal lists
  each failed page with hash, page number, attempt count, and Gemini error.

- **Extraction lab layout** — Dropped intro blurb; cost/path breakdown opens
  from an icon beside the title; status + type filters share one row with
  counts; row hash + copy + eye preview (split modal like page vision lab);
  last-run errors above the list. Summary cards compacted for list height.

### Added

- **IBM watsonx trial spend tracker** — Extraction backfill modal totals
  billed IBM pages/$ and remaining text-page backlog per env key slot.
  Put extra trials in `.env.local` as `DOCLING_IBM_API_KEY_2` … `_4`
  (and matching `DOCLING_IBM_URL_N`). HTTP 402 `usage_limit_exceeded`
  rotates to the next key; keys are never stored. Shows how many extra
  trial keys cover the backlog.

- **IBM Docling backfill backend** — Extraction backfill can run text-route
  pages through **IBM watsonx Docling** (`DOCLING_IBM_URL` +
  `DOCLING_IBM_API_KEY`) instead of the local sidecar. Toggle per run;
  resume keeps the same backend. Same per-page markdown cache. Tracks IBM
  $ at $4/1,000 pages. Sidecar still the default.

- **Extraction backfill UI** — Extraction lab modal (renamed from Docling
  backfill) supports **Full (Docling + vision)**, **Docling only**, or
  **Vision only**. Sample N docs (default 10) or the full corpus; live rate,
  ETA, and cumulative Gemini vision $. Limited samples are size-stratified
  (average representation). Requires sidecar for Docling modes.

- **Docling backfill UI** — Extraction lab “Docling backfill” modal (same
  pattern as contacts/orgs bulk extract): start a server-side run for N docs
  (default 10) or the full corpus, live rate (pages/min + s/page), ETA for
  this run, and corpus ETA extrapolation. Hide/stop/resume; progress in
  `docling_backfill_runs`. Requires `npm run docling:sidecar`. Completed runs
  keep avg rate + corpus ETA on the Past runs list (and a sample summary
  panel).

- **Docling text-page backfill** — Idempotent local CPU job
  (`npm run backfill:docling`, `--all` / `--limit` / `--max-pages` / `--hash` /
  `--dry-run` / `--force`). Converts `route=text` pages via the Docling
  sidecar; skips per-page cache hits; restart-safe. Vision/ambiguous pages
  untouched. Does not swap production CF→Docling or call IBM.

- **Docling lab A/B** — Local Python sidecar (`npm run docling:sidecar`) plus
  Extraction lab “Extract with Docling” in the extract viewer. Converts
  **text-route pages only** (page ranges / per-page cache); vision/ambiguous
  pages stay on Gemini. Lab ↔ Docling toggle is per-page for mixed docs.
  Caches `data/email-attachments/{hash}/docling/pNNN.md` and assembled
  `{hash}.docling.md`. Does not change Cloudflare or Gemini production paths.

- **Attachment extraction lab** — `/analysis/extraction` lists unique
  `attachment_documents` toward `parsed` Markdown. Select N files (default 5,
  hard cap 20) and Process: Cloudflare toMarkdown when needed, then Gemini
  page vision only for pending/failed vision pages. Cost panel breaks down
  Gemini $ and CF tokens by file type (PDF / image / other) and by path
  (text-only vs vision/mixed). No process-everything control. Linked from
  Analysis lab; page-vision lab remains for per-page inspection.

### Fixed

- **Extraction backfill parse status** — Completed Docling/vision backfill
  PDFs now promote to `parsed` (assembled Docling cache + vision pages
  written to the attachment `.md`). Previously only Cloudflare toMarkdown
  and `needs_ocr`→vision wrote that status, so IBM runs left text PDFs on
  Needs work even after conversion finished. Images were already flipping.

- **IBM Docling hosted target** — Hosted watsonx Docling rejects
  `target_type=inbody` (`target kind 'inbody' is not allowed`). Convert
  requests now use `presigned_url` and download markdown from the result
  artifact manifest.

- **IBM Docling result envelope** — Successful IBM converts were throwing
  `empty markdown` because the client only read `document.md_content`. Now
  also reads `result.content` / `documents[].content`, and for hosted IBM
  downloads markdown from the `presigned_url` artifact manifest.

- **IBM Docling form types** — `page_range` is sent as two integer form
  fields (FastAPI `tuple[int, int]`), not a JSON array string. That 422 was
  failing every doc in ~seconds while still counting them as done. Request-
  shape / auth errors now fail the run immediately without advancing the
  doc cursor.

- **Extraction lab Failed filter** — Soft markdown errors (status still
  `pending` with `parse_error`) and missing Cloudflare credentials now appear
  under Failed; CF config errors fail terminal instead of silently retrying.
  Status/type filter pills show live counts.

- **Image vision enrollment** — restore missing `isVisionImageExt` import so
  `.bin` / odd extensions resolve from MIME when enrolling images.

- **Image page-vision enrollment** — Cached `image/png|jpeg|gif|webp`
  attachments enroll as synthetic 1-page `attachment_document_pages` rows
  (`route=vision`, profiler `image-v1`) with `attachment_documents` marked
  `needs_ocr`. New downloads auto-enroll; backfill via
  `npm run enroll:image-attachments` (`--all`, `--hash`, `--dry-run`).
  The page-vision worker sends original image bytes to Gemini (no pdf-lib
  slice). Lab preview uses `<img>` for images; the file API returns the
  correct Content-Type.

- **Page vision lab UI** — `/analysis/page-vision` lists attachments with
  pending/done/failed vision pages, runs Gemini extract per document or page,
  and shows the transcription next to a PDF preview. Linked from Analysis lab.
  List rows show total page count and “awaiting vision” count; Preview (eye)
  opens a modal; Extract pending / Extract page 1 run from each row.
  Vision output opens a split dialog: attachment preview (left) and per-page
  extract (right), with shared page controls (`←`/`→` / chips) so both panes
  stay on the same page.   After a successful extract that clears all pending
  pages, the list switches to the Done filter so the row stays visible;
  rows with saved extracts also get a View output action and a Vision cost
  badge (hover for input/output tokens and model).

- **Page vision worker (Tier 2)** — Pending `attachment_document_pages`
  (`route` vision/ambiguous) can be transcribed via Gemini multimodal using
  one-page PDF slices (`pdf-lib`). Per-page artifacts land under
  `data/email-attachments/<hash>/vision/pNNN.md`, then splice into the
  attachment Markdown substrate with `<!-- vision:page=N -->` markers.
  Documents flagged `needs_ocr` flip to `parsed` once vision pages for that
  hash are terminal and at least one page succeeds. On-demand only:
  `POST /api/email/attachments/vision-batch` or `npm run page-vision`
  (`--limit`, `--hash`, `--dry-run`, `--all`). Requires `GEMINI_API_KEY`;
  optional `GEMINI_MODEL_PAGE_VISION`, `PAGE_VISION_BATCH_SIZE`,
  `PAGE_VISION_MAX_ATTEMPTS`.

### Fixed

- **Page vision result modal** — After extract, the dialog opens on the first
  *done* vision page (not page 1 when that page is `not_needed`). The left
  pane serves a single-page PDF (`?page=N`) so the preview matches the
  selected page. All page chips are shown; text-routed pages show selectable
  PDF text (pdfjs) instead of an empty “vision not needed” placeholder.
  Vision prompts now receive native page text as ground truth and require
  photo captions plus brief image descriptions. Truncated / dash-runaway
  Gemini outputs are rejected and retried; separators are sanitized on
  write and on read.

- **Page vision lab pagination** — Document list uses offset pagination
  (50 per page) with Previous/Next controls; filter/sort/search reset to
  page 1. Header shows `N–M of total`.

- **Page vision lab type filter** — All types / PDFs / Images kind toggle
  plus a PDF/JPEG/PNG badge on each row so enrolled images are findable
  among the larger pending queue.

- **Page vision lab Extract page 1** — The list-row action is disabled once
  page 1 is already done (or otherwise not pending/failed), matching
  Extract pending. Hover shows why it is inactive.

- **Page profiler text coverage** — `text_area_ratio` now measures unique
  (union) glyph coverage on the page instead of summing overlapping text
  boxes. Mixed pages with a real text band plus embedded image tables were
  previously inflated toward ~90% text and under-routed to vision.
  Profiler version bumped to `pdfjs-profile-v2` (re-profile to refresh stored
  page rows).

- **Embedded-image routing** — Pages with non-trivial image paints (≥ ~4% of
  page after ignoring icon-sized paints) now route to `ambiguous` even when
  the text layer is dense (photos, pasted table strips, chart bodies).
  Profiler version bumped to `pdfjs-profile-v3`.

- **Bulk page re-profile** — `npm run profile:attachment-pages:all` refreshes
  `attachment_document_pages` onto the current profiler version (stale/missing
  first; `--quiet` summary logging).

### Added

- **Golden attachment labeling UI** — `/analysis/golden-attachments` lets you
  step through the 20-doc golden set with PDF preview, page route labels
  (`text` / `vision` / `ambiguous`), notes, optional pdfjs profiler hints, and
  writes back to `fixtures/golden-attachments/manifest.json`. Keyboard: ←/→
  page, [/] docs, 1/2/3 routes, S save.

- **PDF page-layout profiler (P0-3′)** — Deterministic per-page triage via
  `pdfjs-dist` (`getTextContent` + `getOperatorList`): `chars`,
  `text_area_ratio`, `image_area_ratio`, `vector_ops`, and a
  `text` / `vision` / `ambiguous` route. Results persist in
  `attachment_document_pages`. Scripts:
  `npm run profile:attachment-pages`, `npm run golden:attachment-candidates`,
  `npm run golden:calibrate-page-profile`, plus
  `fixtures/golden-attachments/manifest.json` for labeled calibration.

- **Attachment Markdown conversion (P0)** — Cached PDF/Office attachments can be
  converted to Markdown via Cloudflare Workers AI `toMarkdown`. Unique files are
  tracked in `attachment_documents` (keyed by content hash), with `.md` sidecars
  stored beside the binary cache. Scanned PDFs with almost no extractable text
  are flagged `needs_ocr` for a later vision pass. Attachment analytics gains a
  **Convert to Markdown** action and conversion status counts. Requires
  `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN`. Persistent volume
  `email_attachments_data` mounts `/app/data/email-attachments` so downloads and
  Markdown survive redeploys.

- **Contacts → Link orgs tab** — Dedicated matching queue for person↔organization
  links: people on the left, deterministic shortlist on the right (corporate
  email domain, company-name co-occurrence, person aliases vs org name/aliases).
  Accept / Reject / Skip without opening each person detail. AI shortlisting can
  extend the right-hand list later.

### Changed

- **Email analysis prefers attachment Markdown** — When
  `attachment_documents.parse_status = parsed`, extraction feeds the Markdown
  sidecar into Gemini instead of re-inlining the raw PDF bytes.

- **Attachment Markdown paths are relative** — `markdown_path` stores
  `data/email-attachments/<hash>.md` (cwd-relative) so container moves do not
  orphan sidecars. Absolute legacy paths still resolve.

### Fixed

- **Stuck `parsing` attachment rows** — Batch conversion reclaims orphaned
  `parsing` statuses left by process restarts (requeue, or `failed` after max
  attempts), matching the bulk-extract stale-run pattern.

- **Encrypted PDF page counts** — `pdf-lib` now retries with
  `ignoreEncryption: true` so owner-restricted PDFs still get a page count when
  readable.

- **Slow organization merges (~30s)** — Post-merge UI waited on a full
  fingerprint rebuild plus a second duplicates scan (O(orgs×cards) mention
  matching and O(n²) fuzzy clustering). Mention stats are now indexed in one
  pass, duplicate candidates use token/4-gram blocking, multi-source merges
  persist in one batch, and the UI applies the merge optimistically while
  refresh runs in the background.

### Added

- **Organizations → Duplicates tab** — Entities → Organizations now has a
  Duplicates sub-tab (same master-detail pattern as Contacts). Organizations are
  clustered by fuzzy whole-name similarity (≥78%) after stripping legal suffixes
  such as Inc / Ltd / LLC; aliases are included in the match. Review and merge by
  hand — nothing auto-merges.

### Changed

- **Organization merge keeps aliases + multi contact fields** — Merging one
  organization into another now keeps the survivor’s primary name and stores the
  absorbed name under **Also known as**. Emails, phones, and websites append
  (deduped) instead of overwriting, including during automatic fingerprint
  coalesce. Each value can be severed independently.

### Fixed

- **Duplicates AI suggest merges `parse_fallback` spam** — Large candidate
  batches often truncated the model JSON, so whole batches were marked
  unresolved as `parse_fallback`. Batches are smaller (6), evidence excerpts
  shorter, output token floor raised, JSON parsing is more lenient (fences /
  trailing commas / truncated close), and failed batches split-and-retry.
  Unreadable replies now show a clear “re-run” reason instead of the raw
  `parse_fallback` token.

- **Contact given names stuck as initials (e.g. M. Lethbridge)** — Three
  related bugs blocked fuller names from sticking: (1) a given name equal to an
  undotted mailbox local-part like `michael@` was treated as pollution and
  discarded; (2) bare initials (`M.`) were not expandable to a matching full
  given name (`Michael`) during prefer/merge; (3) Gmail import stripped From/To/Cc
  display names so header evidence such as `Michael Lethbridge <m.lethbridge@…>`
  never reached contact fingerprinting. Imports now keep display names; registry
  email normalization still uses the bare address.

### Added

- **Contacts → Duplicates AI suggest merges** — On a first-name duplicate
  group, **AI suggest merges** samples evidence emails only for stub candidates
  (first-name only, nameless, or weak surnames like “John W.”), uses full-name
  anchors as profile-only context (no bodies for high-mention cards), and
  returns a session review with merge buckets, synopses, and Approve / Skip.
  Leaving or switching groups discards proposals; Approve runs the existing
  manual merge.

- **Contacts → Duplicates tab** — Surfaces clusters of registry contacts that
  share a first name or email address, sorted by cluster size. Selecting a
  group lists every matching card (first-name-only and nameless stubs first)
  with email occupancy date ranges, quick “select first-name only / nameless”
  actions, and the existing bulk merge dialog — so duplicates like twenty
  “Mark” stubs plus full-name Marks, or nameless shared mailboxes, can be
  reviewed without hunting through the paginated People list. Each card also
  offers **Merge all into this**, which confirms and absorbs every other card
  in the cluster into that survivor in one step.

- **Contact evidence match reasons + pagination** — The Mentions evidence side
  panel labels why each email matched (`Name in body`, `On To`, `On Cc`,
  `From`, etc.), defaults person evidence to content-only, and offers an All
  filter for header participation. Lists paginate (25 per page). Entity
  "mentions" counts now mean name-in-authored-body only. Collapsed row
  previews show ~50 characters before/after the first body mention instead of
  the start of the email.

- **Local dev performance controls** — Set `DISABLE_BACKGROUND_WORKERS=true` in
  `.env.local` to stop bulk extract, Gmail scheduler, and forward workflow from
  auto-starting on `npm run dev`. Set `SKIP_LIVE_MENTION_COUNTS=true` to load
  the Entities list without recomputing verified mention counts on every request.
  Run `npm run backfill:body-text-strict-unique` after migrating to cache
  quote-stripped email bodies for evidence panels and email sidebars.

- **Entities People list pagination** — The Contacts → People list loads 100
  contacts per page (Previous/Next) instead of a silent 500-row cutoff, so the
  full registry count matches what you can browse. Sort (mentions or name)
  refetches from the server across all pages.

- **Digital twin documentation set under `/docs`** — Five interconnected
  specifications for a future lightweight 3D building twin (architecture
  overview, drawing ingestion/filtering, Blender→GLTF spatial nodes, email
  temporal/`nodes.json`/`financials.json` schemas, and Three.js heatmap
  viewer). Specs only; no application code.

### Changed

- **Cached strict unique email bodies** — Evidence panels and email detail
  routes read `body_text_strict_unique` when present instead of reloading
  entire threads and recomputing diffs on every click. Migration adds the column
  and a `thread_id` index on `emails`.

- **Bulk extract defers registry ingest off the LLM thread pool** — Contact
  pass 4 saves the fingerprint merge, queues registry ingest on the serial
  chain, and lets thread workers continue extraction. Ingest drains before the
  run is marked completed. Default thread pool raised to 5
  (`BULK_EXTRACT_THREAD_CONCURRENCY`). Fixes overnight throughput decay as the
  contact registry grows and ingest starts blocking workers.

- **Bulk extract Tier B — parallel threads, serial registry ingest** — The
  server worker runs multiple threads’ LLM passes at once (default 5;
  `BULK_EXTRACT_THREAD_CONCURRENCY`). Thread claim + ordered commit keep
  resume-from-`completedThreads` correct. Contact registry ingest after
  pass 4 is process-wide single-flight so parallel workers cannot create
  duplicate persons. Within-thread email concurrency (Tier A) is unchanged.

- **Bulk extract passes 1–3 run emails concurrently within each thread** —
  Each highlight pass receives the full thread email list (concurrency of 4)
  instead of one email at a time. Multi-email threads finish faster;
  single-email threads rely on Tier B thread parallelism.

### Added

- **Bulk extract runs unattended on the server** — Contact and organization
  bulk extraction no longer depends on an open browser tab. The dev server
  starts a background worker on run create/resume and picks up any `running`
  rows after restart. The UI only polls progress; closing the dialog, switching
  tabs, or the screensaver no longer stalls the batch.

### Fixed

- **Shared mailbox registry cleanup** — Added
  `npm run cleanup:shared-mailbox` (optional `--email=…`, `--apply`) to repair
  contaminated role-mailbox people: coalesce same-identity duplicates (Mehal /
  Haider clones), rename frankenstein given names from last-name-scoped
  evidence, and rebuild occupancy windows from per-email third-pass dates
  (densest cluster when spans are long). Applied for
  `studiopm@iccpropertymanagement.com` so Margot → Atif → Mehal → Haider no
  longer all show `→ present`.

- **Shared role-mailbox identity + occupancy** — Distinct people who successively
  used the same address (e.g. `studiopm@iccpropertymanagement.com`: Margot
  Kempton → Atif Khurshid → Mehal Singh → Haider Mukadam) are no longer merged
  into frankenstein names like "Atif J. Kempton" / "Atif Singh". Apply-time
  guards force `link_email` when given names or surnames conflict; last-name
  prefer no longer picks an unrelated longer surname; given-name evidence votes
  are scoped to a compatible last name; email occupancy defaults to evidence
  `dateMax` and never reopens a closed range with `validTo: null`.

- **Contact given names no longer flip on unrelated longer names** — Preferring
  `Peter` over `Paul` solely because it is longer is removed. Longer spellings
  win only for the same stem (`Ann` → `Anne`). Unrelated names keep the
  existing primary. **Also known as** only retains stem expansions / near-typos
  (not contaminated leftovers like Joseph/Haider/Studio, or bare initials like
  `J`). Entities coalesce majority-corrects stuck wrong first names and runs a
  full-registry alias prune. Pending-merge backfill also re-runs coalesce after
  each batch, and enrich/merge consults evidence majority when stored vs
  incoming given names conflict so a wrong primary cannot lock forever.

- **Entity cards no longer show zero mentions for email-only identities** —
  List / detail "mentions" counts now include emails that evidence a person via
  linked address/phone/title attributes (e.g. CC/From header hits), not only
  authored name-in-body matches. Matches the evidence side panel so mailbox
  stubs and CC'd contacts are not stuck at `mentions 0`.

- **Recovered missing contact first names after local-part cleanup** — Entities
  coalesce now restores given names from fingerprint / third-pass evidence
  (majority vote per email) and from dotted local-parts when the last name
  matches (`shawna.greenspan` → Shawna). Same-mailbox last-only or duplicate
  full-name cards (e.g. Wilson → John Wilson) fold together. Short local-parts
  that are real given names (`adam@…`) are no longer stripped. Runner-up given
  names are kept under **Also known as**.

- **Contact first names no longer use email local-parts** — Fingerprint
  prompts forbid putting the mailbox local-part in `first_name`. Merge /
  enrich prefer real given names over local-part lookalikes (e.g. `Paul`
  over `pgartenburg`), and Entities page coalesce clears existing
  local-part first names. Discarded real first names are kept as
  **Also known as** aliases on the person card (`name_aliases_json`,
  migration `0018`).

### Changed

- **Affiliation proposers tightened** — Domain priors require an exact match
  between a person’s corporate email domain and an org’s email/website host
  (subdomains still allowed); soft name-stem matching is removed. Company-name
  co-occurrence runs only when that person has no domain prior, so corporate
  senders are not flooded with noisy name hits.

### Added

- **OKF integration reference notes** — Deferred design notes at
  `.doc/okf-integration-notes.md`: confirms current extraction/registry work is
  OKF-conducive, maps sibling repo Stage A/B/C + ADR-003 tiers, and records
  adapter guardrails for when OKF wiring begins (no implementation yet).

- **Person ↔ organization affiliations (Step 2B)** — Link-layer employment /
  represents / board_of edges between `contact_persons` and a thin
  `organization_entities` registry materialized from fingerprint identity keys
  (`organization_entities`, `person_organization_affiliations`, migration
  `0017`). Deterministic proposers (corporate email-domain prior + pass-1/2
  `company_names` co-occurrence) write **pending** proposals only; consumer
  mail domains are excluded. AI adjudicates ambiguous candidates but never
  auto-approves. Entities → People shows approve / deny / manual link, plus
  Propose / AI adjudicate / Bridge Insights actions
  (`GET/POST /api/affiliations`). Org manual merges rewrite affiliation FKs to
  the survivor.

### Fixed

- **Bulk extract progress resumes on reopen** — Hiding the modal and opening
  it again rehydrates the amber live panel from the in-progress run and
  resumes status polling while the dialog is open (closing pauses UI refresh
  only).

- **Bulk extract “Failed to fetch” after long runs** — Dev server memory
  restarts mid-extract were marking the whole run failed with a cryptic
  browser error. The message now explains the connection loss, and failed /
  cancelled runs can **Resume from N** to continue at the next unfinished
  thread (cost + completed counts preserved).

### Added

- **Mention frequency curve of best fit** — The Entities mention-frequency
  modal fits Zipf’s law (`y = A / r^s`) and exponential decay
  (`y = A · e^(-λr)`) via log-linear least squares on each load / filter
  change, keeps the better R², and overlays the chosen curve with equation
  + R² in the toolbar.

- **Mention frequency Contacts / Organizations tabs** — The same modal can
  switch between contact and organization series (`GET
  /api/organizations/mention-stats`). Org surface filters include website
  and phone; opening the chart prefers the active Entities page tab.

- **Mention frequency Pareto cutoffs** — Vertical dashed lines mark where
  cumulative mentions (left → right) reach 80%, 90%, and 95% of the series
  total, labeled with the label count included.

- **Contact mention counts aligned** — Entities list + mention chart now use
  distinct attribute-evidence email ids (not the inflated ingest
  `mentionWeight`). The list sorts by that same count so order matches the
  numbers shown.

- **Inbox bulk extraction modal** — On `/emails`, a **Bulk extract** button
  next to **Entity cards** opens a modal to run contact or organization
  extraction across every thread (no per-row selection). Choose type + model,
  watch live progress (current thread/email/pass) and accumulating cost, and
  browse past runs with saved totals (`bulk_extract_runs`, migration `0016`).
  Keep the tab open while a run is active; history survives reloads.

- **Sever org metadata associations** — On Entities → Organizations, each
  filled Name / Role / Email / Phone / Website value has an × control. Confirm
  stores a pairwise negative association (`organization_field_denials`,
  migration `0015`) so re-extraction will not reattach that value to the same
  organization. Matching prefers the org name key so denying a board-member
  email does not ban the address globally.
  `POST /api/organizations/registry` `action: "deny_field"`.

- **Manual merge on all Entities tabs** — Contacts, Equipment, and
  Organizations each show a merge icon on left-list rows. The dialog searches
  by name / email / phone (orgs also website; equipment also manufacturer /
  category / location). Shared `MergeEntityDialog`.
  - Contacts: `POST /api/contacts/registry` `action: "merge"`
  - Organizations: persists identity-key merges
    (`organization_manual_merges`, migration `0014`);
    `POST /api/organizations/registry` `action: "merge"`
  - Equipment: wires the Equipment tab to canonical `equipment_assets`, merge
    via `canonicalId` + event re-point;
    `GET/POST /api/equipment/registry`

### Changed

- **Entities → Organizations tab** — Lists unique organizations from
  extraction pass-4 thread merges (coalesced across threads by email/name),
  with a People-style master/detail layout. Data source matches Entity cards
  → Organizations; `GET /api/organizations/registry`. Falls back to pass-3
  cards when no merges exist. Full org registry / AI decisions not built yet.

- **Entity cards panel kind tabs** — The entity cards side panel (inbox
  **Entity cards** button and thread-page panel) has a **Contacts** /
  **Organizations** tab strip. Each tab shows that kind’s pass-3/4
  fingerprints with the matching field layout; counts appear on the tabs.

- **Inbox extraction actions + badges** — Selecting threads shows **Extract
  Contacts** and **Extract Organizations** (each with the shared six-model
  menu). The violet cost badge is labeled **Contact** (was **Extracted**) and
  sits in the subject column’s meta row beside **Thread**; a fuchsia
  **Organizations** badge appears there after org extraction. Analysis
  Processed / queue badges stay in the status column.

- **Contacts → Entities** — Nav label and page title are now **Entities** at
  `/entities` (legacy `/contacts` redirects). The long registry explainer
  subtext under the page title is removed. Kind tabs: Contacts, Equipment,
  Organizations (Organizations lists pass-4 fingerprint merges; Equipment
  still placeholder).

### Added

- **Organization highlight extraction pipeline** — Parallel four-pass
  organization extraction mirroring contacts: highlight fields
  (`organization_names`, `phones`, `organization_roles`, `websites`), then
  fingerprint entity cards (`name`, `organization_role`, `email`, `phone`,
  `website`), then thread merge. Persists to
  `organization_highlight_extractions` / `organization_fingerprint_merges`
  (migration `0013`). APIs: `GET/POST/DELETE /api/analysis/extract-organizations`
  and `GET …/prepare`. Bulk run from the inbox via **Extract Organizations**.
  Pass 4 saves merges only — no org registry ingest yet.
  Domain focus: property managers, law firms, vendors, insurers, banks, named
  condo corporations (not owner/resident groups or informal community labels).

- **Mention frequency chart** — On `/entities`, **Mention frequency** opens a
  modal bar chart (ported from condo-insights `MentionsChartDialog`): Y =
  mention count, X = labels; zoomed-out x-axis uses dots instead of labels;
  scroll zooms, drag pans, hover shows detail. Filters: All / Name only /
  Email only / Fingerprints. Data from the person registry via
  `GET /api/contacts/mention-stats`.

- **Person mention evidence on `/contacts`** — Name-only people (no email /
  phone / title) previously showed a mention weight with nothing to click.
  The person's **name** is now the clickable value (same pattern as email /
  phone / title). Mentions count only emails where the name appears in
  *unique authored* text — quoted reply history is ignored, matching
  extraction. Clicking the name opens the evidence side panel
  (`GET /api/contacts/evidence?kind=person&id=…`).

- **Contact attribute evidence side panel** — On `/contacts`, clicking a
  person's title, email, or phone opens a right-hand panel of source emails
  (collapsed by default; expand to load the body). Mentions are highlighted
  only when they sit near that person's name, so another building's
  "Condominium Manager" in the same message is not marked. Evidence is
  matched against each message's *authored* body (live thread-unique /
  quote-stripped text), so a title that only appears in quoted reply history
  does not pull later thread messages into the panel. MJML/ESP plain-text
  parts that dump CSS resets (`#outlook`, `.mj-column-*`) are ignored in
  favor of the HTML body so the panel does not show stylesheet noise; HTML
  stripping also collapses indent-only blank lines left by table layouts.
  For **email** attributes, From/To/Cc participation counts (addresses rarely
  appear in the body). Nameless / weak-name mailbox stubs that share an
  address (e.g. multiple `studiopm@…` cards) auto-coalesce into the strongest
  named occupant on `/contacts` load and during sweep. API:
  `GET /api/contacts/evidence?kind=title|email|phone|person&id=…`.

- **Global contact registry (entity card merge)** — After thread fingerprint
  pass 4, cards ingest into a person-centric registry (`contact_persons` plus
  time-bounded emails/phones/titles). Fuzzy matching only shortlists
  candidates; AI adjudicates `merge` / `link_email` / `keep_separate` /
  `enrich`. Shared role mailboxes can sit on multiple people with occupancy
  ranges; `contact_email_index` tracks the current primary. High-mention
  cards process first (Pareto). Sparse first-name stubs stay unmerged.
  UI at `/contacts`; resolve-at-time via `GET /api/contacts/resolve`.
  Prior pass-4 merges (from before this registry existed) show as pending and
  auto-ingest on first visit to `/contacts`, or via **Process pending merges**.
  The Emails **Entity cards** panel remains per-thread raw fingerprints;
  `/contacts` **AI decisions** tab lists each adjudication (`merge` /
  `keep_separate` / `link_email` / `enrich`).

- **Inbox entity cards panel** — On `/emails`, an **Entity cards** button left
  of the Individual / By thread toggle opens the fingerprint side panel for
  threads on the current page that already have pass-3/4 cards. The thread
  filter offers **All threads** (cards labeled by source thread) or a single
  extracted thread (preferring that thread’s 4th-pass merge when available).

- **Bulk contact extraction from inbox** — With threads (or messages) selected,
  **Run Extraction** opens a model menu matching the six contact-extraction
  variants on the thread page. After confirm, each selected thread runs all
  four passes in series (one email at a time for passes 1–3, then merge).
  Thread rows show a violet phase badge while running (`Preparing…`, then
  `Phase 1 · extracting 2 of 4`, etc.). When complete, an **Extracted $X.XX**
  badge persists from stored runs (survives refresh); hover shows the same
  contact-extraction model table as the thread page.

- **Contact fingerprint merge (4th pass)** — After per-email fingerprints, a
  nested **4th pass · merge** combines duplicate entity cards across the
  current email set into unique people (same address always merges; email-only
  stubs fold into richer named cards). Results store in
  `contact_fingerprint_merges`. The Entity cards panel **All emails (merged)**
  view shows the unique set; picking a single email still shows that message’s
  unmerged pass-3 cards. Re-running passes 1–3 clears the merge for that model.

- **Contact fingerprint (3rd pass)** — After highlight passes, each model row
  offers a nested **3rd pass · fingerprints** that builds per-person entity
  cards (`first_name`, `last_name`, `email`, `phone`, `job_title`) from that
  message’s From/To/Cc headers, authored body, and merged pass-1/pass-2
  extractions (not the whole thread). Partial cards are allowed; the model may
  link greetings to mailbox addresses when evidence supports it, but must not
  invent last names from email local-parts alone. Results store in
  `contact_highlight_extractions` third-pass columns. An **Entity cards**
  button opens a side panel with an All list plus a per-email filter.
  Re-running pass 1 or 2 clears fingerprints for that model.

- **Contact highlight second pass** — Under each model row on the email
  contact-extraction table, a nested **2nd pass** row runs the same model
  with the email excerpt plus first-pass finds, and returns only newly
  discovered names / phones / titles / companies. Cost and token usage are
  tracked separately; selecting the 2nd-pass row highlights only the new
  finds. Re-running the first pass clears the second pass for that model.

- **DeepSeek Extended Thinking row** — Contact extraction also offers
  **DeepSeek V4 Flash 0731 · Extended Thinking** as its own model row (same
  API model, thinking enabled, higher max tokens). The original DeepSeek row
  keeps thinking off for cheap/fast JSON extracts.

- **DeepSeek no-thinking → Thinking pair** — A hybrid row
  (`DeepSeek V4 Flash 0731 → then Thinking`) runs pass 1 with thinking off
  and pass 2 with Extended Thinking on the same API model, so the second
  pass can hunt for misses with a larger reasoning budget.

- **DeepSeek chunked extract** — `DeepSeek V4 Flash 0731 · Chunked` keeps
  thinking off and still runs one email per message, but splits each email
  excerpt into ~500–1000 character paragraph packs (sentence-split when a
  paragraph is oversized). Each chunk is its own API call (system prompt
  repeated), results are merged, and token/cost totals sum across chunks.
  The nested second pass uses the same chunking.

- **Contact highlight extraction on email threads** — On the email detail
  view, an **Extract contacts** control runs one LLM pass per teal
  unique/highlighted message section and returns contact names, phones, job
  titles, and company names. Matches are color-marked in that section
  (blue / red / amber / green) with a legend. Results are saved per email and
  model in `contact_highlight_extractions` and reload when you revisit the
  page. Does not replace full thread analysis.
  Choose among Gemini 3.6 Flash, Gemini 3.1 Pro, and DeepSeek V4 Flash 0731
  via a selectable results table (one row per model; empty until run). Selecting
  a row swaps which extraction highlights appear in the thread below; each run
  shows estimated cost and token usage. DeepSeek needs `DEEPSEEK_API_KEY` in
  `.env.local`.

### Changed

- **Contact highlight company context** — Shared system prompts (all models,
  pass 1 and pass 2) now include a short Studio 1 condo domain note so
  owner/resident groups and Facebook pages are not treated as companies.

- **Email authored vs highlight unique** — Analysis preprocess now stores an
  *authored* body in `bodyTextUnique` (reply quotes and duplicate thread
  forwards removed, but the full top-of-message block including signatures is
  kept on every send) so contact extraction still sees phones/emails/titles in
  footers. The email detail UI continues to highlight a stricter per-message
  unique span (may omit a repeated signature). No signature-detection heuristics.

### Fixed

- **Contact extraction DeepSeek empties** — DeepSeek V4 Flash thinking (on by
  default) was consuming the whole `max_tokens` budget on longer excerpts,
  leaving empty `content` that was stored as a successful empty extraction.
  Contact highlight calls now disable thinking and treat empty/truncated
  responses as errors instead of silent skips.

- **Contact extraction bloated excerpts** — When strict unique text could not
  align to the display body (e.g. a repeated signature line already stripped),
  the fallback cut at a nested Gmail `On…wrote:` inside Outlook quote history
  and sent several× too much text to the LLM. UI highlight and extract excerpt
  now reject reply-quote fallbacks that balloon past the unique length and fall
  back to the plain unique string.

- **Email body line wrapping in thread view** — Message detail was rendering the
  soft-wrapped `text/plain` part (hard breaks every ~72 characters), so paragraphs
  looked like a narrow ragged column even when a proper HTML body was already
  stored. Display now prefers the HTML part (converted to markdown for safe
  rendering) and only falls back to plain text with a structured soft-wrap
  unwrap that keeps real paragraph breaks, quotes, and short intentional lines.

- **Thread subject search typing** — Typing in the threads search box no longer
  drops mid-word characters or jumps sideways when results refresh. The input
  keeps local state while a debounced URL update is in flight (so a slower
  navigation cannot overwrite newer keystrokes), search sits on its own row so
  the changing `(count)` in the title cannot shift it, and the thread list clips
  horizontal overflow (truncated subjects / status cells) that `overflow-y-auto`
  was surfacing as a horizontal scrollbar once the filtered set changed.

- **Full-thread Gmail import** — Personal Sync (first run, history, and the
  48-hour safety window) previously stored only messages that themselves matched
  the sender allowlist, so replies from non-allowlisted participants in the same
  Gmail thread were dropped (e.g. a condo thread that Gmail shows as 8 messages
  could land as 5). Sync now expands each allowlist hit to the entire thread,
  matching Backfill / Import thread. Re-run **Backfill all allowlist** once to
  fill gaps in older incomplete imports; duplicates are skipped.

### Added

- **Cost-figure guardrail for ratifications** — Section 4.1 ratification line
  items are email-approved vendor expenses, so each should carry the dollar
  amount from the board package. Generation now (a) instructs the model to put
  every stated amount in the structured `cost_mentioned` field and the summary
  text verbatim — never rounding, omitting, or generalizing to "a cost was
  approved" — and (b) runs a deterministic post-extraction check that flags any
  ratification item (and its sub-items) with no dollar figure, surfacing it as a
  post-generation warning so a reviewer can confirm the amount was not dropped
  (e.g. pool $7,741.80, marble $155k, riser $3,390).

- **Auto-run coverage check after generation** — A freshly generated meeting now
  runs the omissions and decision check automatically on first open and surfaces
  the results in the analysis dialog, so coverage gaps (e.g. an agenda item the
  AI dropped entirely) no longer depend on the user remembering to click "Check
  omissions." The auto-run is scoped to post-generation only: reopening an
  already-analyzed or finalized meeting never triggers an extra (billable) run.

- **Decision verification (omissions check)** — The transcript analysis pass now
  cross-checks every recorded motion and decision against the transcript and
  flags any that are contradicted, unsupported, or uncertain (e.g. minutes that
  record a motion as "carried" when the board actually deferred or asked to
  inspect first). Section 4.1 email-ratifications and previous-minutes approvals
  are intentionally excluded. Findings appear in a read-only "Decision checks"
  tab in the omissions dialog with the recorded claim, what the transcript shows,
  a supporting quote, and a suggested correction. Catches fabricated or
  mis-recorded approvals that look legitimate on a proofread. Each flag offers
  one-click corrections — "Set motion → Deferred" or "Remove motion" — that
  locate the exact agenda item and update the structured minutes (and PDF
  export) directly.

### Fixed

- **Omissions apply loop after generation** — Applying minutes, to-do, or decision
  corrections from the omissions dialog no longer restores the full pre-apply
  findings list after save. Applied items are now persisted in
  `omissionsAnalysisJson` alongside the merged minutes, so a refresh no longer
  re-shows already-applied omissions or duplicates agenda items when "Apply all"
  is clicked again.

- **Duplicated action items on initial generation** — Document sanitization now
  collapses action items to one entry per assignee (joining multiple duties with
  "and") for every agenda item and sub-item, so a model that emits duplicate
  per-assignee entries during the first extraction no longer produces run-on
  "Action:" lines. Previously only the omissions-merge path deduped; the initial
  generation relied on the model getting it right. Consolidation is idempotent,
  so the already-deduped merge paths are unaffected.

- **Duplicated minutes action items after omissions merge** — Applying an
  "augment existing" omission finding no longer doubles the agenda item's
  action line. The omissions analyzer returns action items that are already
  consolidated per assignee (existing duty plus newly found duty joined with
  "and"), so they now replace the matching assignee's entry instead of being
  concatenated with it. Concatenation previously re-joined the near-identical
  text into a run-on "Action:" sentence that repeated itself.

- **Docker production build OOM** — Raised the Node.js heap limit during `next build`
  and skip ESLint in that step so type-checking no longer exhausts memory on Coolify.

- **Gmail sync cursor** — `lastHistoryId` now advances only after a clean history
  import (zero per-message errors). Failed or partial syncs leave the cursor in
  place so the next run retries the same range instead of skipping mail. Expired
  history cursors reset only after a successful safety-window catch-up.

### Added

- **Sync history error popover** — Failed, interrupted, and partial sync rows show
  a badge; hover to see categorized error details (message failures, history
  cursor, general).

- **Tiered calendar deduplication** — Calendar extractions now use two dedup tiers
  before and after persist. Tier 1 collapses exact duplicates (same date plus
  identical source quote, or same calendar day for meetings) during document
  merge and when writing calendar_events. Tier 2 runs AI thread reconciliation
  after each email analysis to merge semantic duplicates with different wording
  while keeping legitimately distinct events on the same date. The extraction
  panel thread view shows reconciled calendar rows from the database, matching
  the equipment pattern.

- **Equipment extraction redesign (Phase 1)** — Structured `equipment_mentions` with
  `kind` (equipment / manufacturer / component) and `significance` (major / minor).
  Thread-level equipment reconciliation merges duplicate and alias names into canonical
  assets. Insights and Building default to major equipment only, with a toggle to show
  minor items, components, and manufacturers.

- **Building equipment registry (Phase 2 foundation)** — `building_equipment_registry`
  table and import stub for future drawings/specs. Registry entries inject into the
  extraction prompt and drive the 3D Building render when populated.

- **Multiple emails per contact** — Approved person contacts can have more than one
  email address. When email analysis finds a known contact writing from a new
  address, Insights shows an **Additional emails** review card so the board can
  confirm linking it to the existing contact.

### Changed

- **Extraction panel delete dialog** — Thread delete now lists the same extraction
  categories shown in the side panel (Vendors & contracts, Capital projects,
  Calendar, Named entities, and so on) instead of Insights tabs. Selecting all
  categories fully resets the thread for re-analysis; partial deletes remove
  saved rows and archive fields for the chosen categories only.

- **Local dev server** — `npm run dev` now binds to port 3010 (was 3000). Added
  `npm run dev:restart` to free port 3010 and start the dev server again. Update
  `GOOGLE_REDIRECT_URI`, `NEXT_PUBLIC_APP_URL`, and your Google OAuth client
  redirect URI if you still use `localhost:3000`.

- **Mobile layout (initial pass)** — Header navigation collapses into a hamburger
  menu below the `md` breakpoint. Email inbox processed badges show only the
  message count and processor initials on small screens; date and time stack on
  separate lines with the time on the second line.

### Fixed

- **Extraction panel delete kept maintenance & equipment** — Deleting thread equipment
  data removed maintenance events but left reconciled equipment visible in the side
  panel. Purge now removes orphaned `equipment_assets`, strips equipment fields from
  the extraction archive without re-validating the document, and the thread panel
  always prefers reconciled equipment over raw archive rows.

- **Insights Equipment tab empty for extracted equipment** — Email analysis extracted
  `equipment_mentions` (e.g. booster pump, vendor pump brands) into the side panel
  but only persisted dated `maintenance_events`. Equipment-only threads now save
  each mention to `equipment_assets` and a `mentioned` maintenance event so they
  appear on Insights → Equipment.

- **Header user initials** — The avatar badge now shows the first initial of the
  user's first and last name instead of the first two characters of their email.

- **Email analysis in production** — Idempotent migrations now create and backfill
  the full email-analysis schema on older databases (`extraction_skill_entries`,
  `entity_mentions`, `entity_exclusions`, and related columns). Startup migration
  logs warn when required analysis columns are still missing after migrate.

- **Clear-all sync history** — Deleting all imported emails no longer wipes sync
  history. A **Clear all** row is appended with how many emails and threads were
  removed, so a large re-import on the next sync is easier to explain.

### Changed

- **Sender allowlist layout** — Import estimate and backfill panels now use a
  50/50 split. Add sender moved into a dialog opened from the toolbar above the
  sender list. The sync estimate also shows how many allowlist threads and emails
  are already imported.

- **User deletion** — Super admins can delete users from the Users page. A
  confirmation dialog explains that the account and associated auth data are
  removed while shared app content remains.

- **Date display** — App-wide dates now use long month names (for example,
  June 20, 2026) instead of ISO-style `YYYY-MM-DD` formatting.

- **Allowlist sender sort** — Sender allowlist defaults to **Most in personal
  Gmail** instead of email A–Z.

### Added

- **Allowlist sender thread counts** — In app and Personal columns show email
  counts with thread counts in parentheses (for example, `470 (38)`).

- **Backfill all allowlist** — Sender allowlist tab includes a backfill action
  beside the import estimate that searches personal Gmail for every saved sender
  and imports historical threads not yet in the app. The estimate shows remaining
  unsynced thread and email counts, not the full Gmail total.

- **Allowlist import preview** — Sender allowlist tab shows estimated thread and
  email counts for the next sync from personal Gmail, based on the saved
  allowlist or the current row selection.

- **Stale sync history rows** — Manual or scheduled syncs that never finished
  (e.g. dev server restart or request timeout) are now auto-closed after two
  hours and shown as **Interrupted** instead of staying on **Running…** forever.

  sign-in via middleware and a server layout guard, sending visitors to `/login`
  when auth is enabled and they have no session.

- **User menu when logged out** — The header avatar menu is hidden on login and
  signup pages instead of showing a placeholder “U” with settings.

- **Forgot password flow** — Sign-in page links to forgot password; users receive
  a one-hour reset link by email (SMTP) or a local dev link when email is not
  configured. Reset completes with a new password and signs them in.

### Added

- **Sync history** — Email settings → Sync controls lists recent manual and
  scheduled sync runs with start time, trigger (manual vs cron job), and how
  many allowlist emails were imported (scrollable table, max 300px height).

- **Smarter entity review prefill** — Contact review cards now parse role/title and
  organization from signature-style context snippets (e.g. "Name, Project Manager,
  Company Inc."). Organization cards are listed first. Approving an organization
  automatically links matching pending contacts from the same email thread and
  selects that org in their dropdown.

- **Richer entity review context** — Review snippets now merge thread subject,
  extraction summary, cached PDF attachment text, related surety/bond mentions,
  and the original extracted line. Attachment PDF text is cached alongside the
  file on first read so later page loads stay fast.

- **Organization role customization** — Entity review organization role dropdown now
  includes **+ Add new role…**, which opens a dialog to create reusable custom roles.
  Built-in roles also include **Condominium corporation** for TSCC numbers and
  similar legal corporation names (including sister buildings with different
  corporation numbers).

- **Entity review delete** — Pending entity review cards now include a **Delete**
  button that removes unrelated extractions from the database. **Ignore** still
  keeps the record and tells the AI to skip similar contacts in future emails.

- **User accounts with roles** — Sign up and sign in pages, three roles
  (`super_admin`, `admin`, `user`), and middleware-enforced access. Super admins
  manage all users on `/users`; admins can access every other page; regular users
  can view and analyze content but not admin settings, bulk analysis, concepts, or
  dev notes.

- **Analysis attribution** — Email and thread analysis runs now store
  `triggered_by_user_id` on `extraction_sources` so you can see who ran each
  analysis.

### Changed

- **Action item semantic deduplication** — before persisting new email action
  items, a Gemini pass compares the incoming batch against open tasks in the same
  thread using obligation-level matching (not fuzzy text or exact dedup keys).
  Cross-assignee duplicates (e.g. "Management" vs a named contact for the same
  police-footage request) are consolidated to one insert. Thread reconciliation
  now also clusters open semantic duplicates first and supersedes extras even
  when the obligation is still unresolved.

- **Action item reconciliation scope** — thread reconciliation now runs only against
  emails already analyzed in chronological order (not the full synced thread).
  "Send calendar invite" tasks are excluded from LLM thread reconciliation and
  close only when a separate meeting-invite email (e.g. Microsoft Teams) is
  analyzed.

- **Extractions default view** — the list view on `/extractions` now defaults to
  **By thread** instead of by individual email.

- **Named entities deduplication and display** — extracted people, orgs, dates,
  and phone numbers are merged intelligently (e.g. "Paul" + "Paul Gartenburg",
  "ICC Property Management" + "ICC Property Management Ltd.") in the extractions
  audit UI, on Insights, and when persisting to `entity_mentions`. The Insights
  page now includes a **Named entities** section matching the extraction routing
  link.

- **Named entities audit grouping** — dates are no longer shown in named entities
  (calendar fields cover those). People, organizations, and phone numbers are
  grouped into contact cards when they share email context. In thread audits,
  teal tags show which email each field was extracted from.

- **Named entities completeness** — the audit view now includes organizations
  from both `entities[]` and `vendors[]`, so property managers and other orgs
  flagged only as vendors still appear under Named entities. Vendor-flagged orgs
  show an amber **Vendor candidate** badge.

- **Vendor review queue** — newly extracted vendors are saved as `pending` until
  a board member approves them on Insights, with rename and role selection
  (vendor, property manager, contractor, etc.).

- **Unified entity review** — all extracted people, orgs, and phones are staged
  in `entity_mentions` as pending until approved on Insights **Entity review**.
  Extractions and Insights now use the same grouped contact cards; standalone
  phone-number cards are hidden. Vendor directory entries are created only after
  org approval.

- **AI entity reconciliation** — after each email in a thread is analyzed, a
  follow-up Gemini pass reviews all pending `entity_mentions` for that thread.
  It merges duplicates (e.g. "P. Gartenburg" + "Paul Gartenburg"), fixes wrong
  person/org pairings using signature and From: evidence, and attaches phones to
  the correct contact before human review. Thread view on Extractions shows the
  reconciled entity set from the database.

- **Contact-style entity review** — Insights entity review now uses standard
  contact forms: person cards include first/last name, email, organization
  dropdown, role/title, and phone; organization cards include name, role, email,
  and phone. Approving an organization adds it to person dropdowns above without
  losing in-progress edits. **Ignore** registers stale signatures (e.g. old
  employers) in an exclusion list the AI sees during future extractions.

- **Vendor directory vs organizations** — only vendor and contractor roles are
  added to the vendor directory and shown under Vendors & contracts on
  Extractions after review. Property managers and other roles stay in named
  entities only.

- **Personal Gmail is now the primary sync source** — Sync now and automatic
  (scheduled) sync both pull allowlist-matching mail directly from personal
  Gmail using incremental `historyId` tracking. The dedicated condo mailbox is
  optional and no longer drives sync. Reset imported inbox clears personal sync
  state so the next sync can re-import from scratch. The global backfill button
  was removed; use **Import thread** on a sender row for full conversation
  history per sender.

### Fixed

- **Entity review vendor candidate badge** — approving or ignoring an entity in
  Insights now clears the AI **Vendor candidate** flag; the user's chosen
  organization role is the source of truth after review.

- **Personal forward workflow start** — fixed a crash when scanning large
  personal mailboxes (Postgres parameter limit on the already-forwarded lookup).
  Start now returns immediately and shows live progress while batches run in the
  background.

- **Allowlist personal Gmail counts** — personal From counts now paginate
  through Gmail results instead of using `resultSizeEstimate`, which was returning
  the same mailbox total for every sender. The allowlist table layout was fixed so
  column headers align with their data.

### Added

- **Forward workflow thread count** — the personal forward status panel now
  reports unique Gmail threads alongside individual message counts when a run
  starts (e.g. “10,286 messages in 3,421 threads”).

- **Forward workflow full threads** — matching now expands each allowlist hit to
  the entire Gmail conversation (including your replies and other participants),
  forwards messages oldest-first, and sets In-Reply-To / References so threads
  stay grouped in the dedicated inbox.

- **Email settings — automated personal forward workflow** — forward
  allowlist-matching messages from personal Gmail to the dedicated condo mailbox
  in batches of 50 every 2 minutes. Select sender rows for a subset, or use all
  saved allowlist senders. Tracks already-forwarded messages so reruns skip
  duplicates. Requires reconnecting personal Gmail with `gmail.send` permission.

- **Email settings — sender discovery** — the allowlist shows every unique From
  address in imported mail, with separate counts for messages in the app and in
  connected personal Gmail. Unsaved senders get a Save button; entries already in
  the database show a disabled Saved state with backfill and remove actions.
  Copy a single address or the full Gmail filter OR list from the toolbar.
  Select rows to copy a smaller OR list for split Gmail filters.

- **Email settings — reset imported inbox** — delete all imported emails, threads,
  sync runs, and email extractions from the app so you can run a fresh dedicated
  sync. Gmail connections, allowlist, and mailbox contents are unchanged.

### Fixed

- **Gmail OAuth callback redirect** — after connecting Gmail in production, the
  app now redirects to `NEXT_PUBLIC_APP_URL` instead of the container’s internal
  `0.0.0.0:3000` address when running behind Coolify or another reverse proxy.

- **Gmail dedicated OAuth consent hang** — dedicated mailbox connect now uses
  incremental scope consent (`include_granted_scopes`) and a pinned-account
  flow when `GMAIL_DEDICATED_EMAIL` is set. Settings documents the Google Cloud
  `gmail.modify` scope requirement when consent stalls on Continue.

### Changed

- **Extractions audit card (By email view)** — redesigned for human review
  clarity. The collapsed card now leads with the email summary and a single
  "N facts found" count (extracted facts only, excluding classification
  metadata and tags) instead of the previous hover-only "extracted items" and
  "destinations" badges. The expanded view presents one flat, scannable list of
  extracted facts grouped by destination, with a quiet per-group save signal
  ("Saved → table", "Partly saved", or "Archive only") replacing the per-item
  "Saved to DB" / "Extraction only" pills and the separate "Rows saved from this
  run" block. Summary metadata (document type, summary, urgency, tags) is now
  visually de-emphasized and pinned to the bottom so it no longer competes with
  real extracted facts.

- **Local dev server** — `npm run dev` now always binds to port 3000 so Gmail OAuth
  redirect URIs stay aligned with `GOOGLE_REDIRECT_URI` in `.env.local`.

- **Email backfill cutoff** — the backfill boundary on Email Settings is now
  computed automatically from dedicated sync: one second before the oldest
  message imported from the condo mailbox. The manual date picker was removed.

- **Building email side panel** — attachments appear in a clickable row above
  the message body; tapping opens an inline preview (images and PDFs) without
  download actions. PDF chips use amber styling (not error red); PDF previews
  render with pdf.js instead of a blank iframe.

- **Building 3D viewer (POC)** — temporary model updated to approximate the
  real footprint: six underground parking levels, a wide nine-floor podium, and
  a narrower fifteen-floor tower centered on the podium. Equipment markers and
  floor labels use parking levels (P1–P6) below street level.

- **Email analysis prompts** — calendar-facing fields (`maintenance_events`
  action/equipment, `meetings` type, `deadlines` description) must use sentence
  case, not all lowercase or title case on every word.

- **Emails inbox default view** — `/emails` now opens in **By thread** view;
  use **Individual** or `?view=messages` for the per-message list.

### Added

- **Emails inbox extraction badge** — each thread and message row shows a violet
  metadata badge when analysis has run. Hover to open a popover with document
  type, summary, urgency, tags, per-domain counts, and key extracted facts;
  thread rows group metadata by message when multiple emails were analyzed.

- **Email backfill cutoff date** — on Email settings, set a cutoff date before
  running personal Gmail backfill so only mail received on or before that day is
  imported. Avoids duplicating messages already synced through the dedicated
  mailbox.

- **Building 3D viewer (POC)** — new `/building` page with an interactive
  fictitious multi-floor model: orbit/zoom controls, glowing color-coded equipment
  markers by category (pumps, air handlers, boilers, etc.), hover/click tooltips,
  and a legend to toggle categories. A tab strip switches between the 3D render
  and a table view of equipment assets and maintenance events extracted from
  analyzed emails; the table view has its own Assets / Events tabs. Asset rows
  include a hover popover of linked source emails; event rows link to the source
  email in a side panel without leaving the page.

- **Board package page picker** — when generating a meeting, upload the full
  management report PDF, preview pages, and choose which pages to include (e.g.
  first 15–20); unchecked pages are stripped before Gemini ingestion.

- **Emails inbox bulk analyze** — checkbox per row (messages or threads), select-all
  on the current page, and **Analyze selected** calling the existing batch analysis
  API (50 emails per request).
- **Processed badge cost** — shows total Gemini spend for that message or thread
  (summed across messages in a thread).
- **Processing badge** — amber “Processing N of M” on thread rows while analysis
  runs (analysis queue + polling); thread count and processed status share one badge.
- **Inbox analysis status bar** — shows bulk progress (“Analyzing 3 of 12”),
  waiting queue (“Waiting 2 of 5” per thread), and failed badges; survives page refresh
  via server-side analysis queue.

- **Settings → Delete all processed data** — confirmation dialog removes meeting
  workspaces, email-analysis extractions (calendar, insights, action items,
  discovered facts, analysis queue), and global todos while keeping imported
  emails, threads, and attachments intact. Resets `processed_at` on emails so
  they can be re-analyzed.
- `POST /api/analysis/purge-processed-data` and
  `lib/analysis/purge-processed-data.ts` backing the settings action.
- `meeting_cancellations` extraction array in `EmailExtractionDocument`
  (parsed, merged, and persisted). Lets the LLM signal that an email is a
  cancellation/postponement notice for a previously-scheduled meeting so the
  matching calendar entry can be removed instead of duplicated.
- `scripts/purge-analysis-data.mjs` — wipes all AI-derived analysis data
  (meetings, global todos, extraction sources, calendar events,
  maintenance/budget/invoice/contract/issue/project rows, action items,
  entities, discovered facts, extraction skill tables, analysis queue) and
  resets `emails.processed_at` and attachment analysis cache fields so the
  pipeline can be re-run from scratch. Email bodies, attachments, threads,
  and sync history are left untouched.

### Changed

- **Calendar pipeline is now conservative about what qualifies as an event.**
  - The email-analysis system prompt now explicitly defines what belongs in
    `meetings[]`, `meeting_cancellations[]`, `deadlines[]`,
    `maintenance_events[]`, `inspections[]`, and `action_items[]`. The LLM
    is told to prefer omitting a fact over fabricating a date or status.
  - Meeting calendar-event dedup now keys on `(date, time)` only, not on the
    LLM-extracted `type` string. Multiple emails or attachments describing
    the same meeting (with varying type wording like "Board", "Board
    Meeting", "Board of Directors") now collapse into a single calendar
    entry. Titles are normalized to avoid stuttering like "Board Meeting
    meeting".
- `persistExtractionDocument` processes `meeting_cancellations` before
  meetings: it deletes any existing calendar event for the cancelled slot
  and suppresses any meeting in the same document that occupies the same
  date/time slot (covers the common case of a cancellation email whose
  `.ics` attachment still describes the original invite).

### Removed

- Auto-promotion of `action_items` to `calendar_events`. Previously, every
  action item with a non-null `deadline` (often a soft "by the next meeting"
  date inferred by the LLM) was inserted into the calendar, polluting it
  with entries like "share any thoughts, questions, or recommendations
  regarding the presentation". Action items now live only in the action-item
  table; hard external deadlines must come through `deadlines[]` to reach
  the calendar.

### Migration

After deploying, run `node scripts/purge-analysis-data.mjs` once and then
re-analyze emails from the **Emails** UI (per-thread or per-message
**Re-analyze** button) so the calendar is rebuilt under the new rules.
