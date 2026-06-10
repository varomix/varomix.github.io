---
title: "Kiln & Spark — A C GUI Framework and Flash-Style Animation Tool"
description: "A Flash-inspired 2D animation application and retained-mode GUI framework written in C. Built to explore the architecture of professional creative tools, including custom UI systems, vector graphics, GPU rendering, animation timelines, and pressure-sensitive drawing workflows."
tech: ["C", "SDL3", "OpenGL ES 3", "FreeType", "Clay"]
featured: true
weight: 3
---

## What Is It?

Kiln and Spark are a GUI framework and a Flash-style animation tool — built entirely from scratch in C, with no app framework, no game engine, no shortcuts.

Think Adobe Animate or the drawing tools in Figma: a canvas where you draw vector shapes with a pressure-sensitive brush, animate them across a timeline, and preview the result with onion skinning. That's Spark. Kiln is the invisible layer underneath it — the buttons, panels, docking workspace, text rendering, and undo system that make Spark feel like a real application.

Every part of both tools was written by hand, from the widget system to the GPU renderer to the bezier math.

## Why Did I Build It?

I've spent years working with professional creative tools — Houdini, Unreal, DCC pipelines — and I wanted to understand what's actually happening under the hood. How does a docking workspace know where to drop a panel? How does a brush stroke become a filled vector shape that merges cleanly with the one next to it? How does a timeline sync with a playhead at configurable FPS?

The only honest way to answer those questions was to build it myself.

Kiln and Spark started as a learning project and became a portfolio piece: a demonstration that I can work at the systems level, reason about rendering pipelines, and ship something that functions as a real tool — not just a proof of concept.

## What Did I Learn?

**Bezier boolean operations are deceptively hard.** Merging two brush strokes into a single clean shape sounds simple. It isn't. The algorithm I used (Bezier clipping, Sederberg & Nishita 1990) is elegant on paper, but edge cases pile up fast — tangent intersections, overlapping segments, self-crossing paths. Getting it right took more time than everything else in the vector engine combined.

**I picked the wrong renderer first.** I built a stencil-based vector renderer early on, then realized the GPU SDF pipeline was faster, simpler, and handled variable-width brush strokes for free. I ended up maintaining both. If I started over, I'd build the SDF renderer first and only add stencil-and-cover for the edge cases it can't handle.

**Build the infrastructure early.** I added the docking system late and had to retrofit every existing panel to fit it. Same story with image loading — I deferred it, and now toolbar icons are text-only. Both would have been painless if I'd done them first.

**Caller-owned state makes undo trivial.** Because every widget's state lives in a struct the application owns, undo is just snapshotting those structs. No hidden framework state, no serialization tricks. This design decision paid off everywhere.

## Key Results

| | |
|---|---|
| **GPU SDF brush pipeline** | Boolean stroke merging on the GPU via GL_MIN blend — no CPU boolean ops at draw time |
| **Real-time pen input** | Bezier fitting and boolean ops complete within a single frame at 120 Hz |
| **Vector boolean ops** | Full union / intersect / difference / XOR in bezier form — no polygon conversion |
| **Widget types** | 30+ across buttons, inputs, containers, data displays |
| **Timeline** | 16 layers × 300 frames, configurable FPS |
| **Undo/redo** | 256-entry ring buffer, 10 command types |
| **Onion skinning** | Draggable range, red/blue tint, opacity falloff |
| **Tests** | 53 passing across bezier math, boolean ops, and bezier fitting |
| **Build** | `cmake -B build && cmake --build build` — 0 errors, 0 warnings |

---

## Screenshots

<!-- SCREENSHOT 1: The full Spark workspace — docking panels visible (viewport, timeline, layers, properties). Caption: "Spark running with a full docking layout. All panels are draggable and re-dockable at runtime." -->

<!-- SCREENSHOT 2: A close-up of the canvas with two overlapping brush strokes merged into a single clean vector shape. Caption: "Two freehand brush strokes merged into one shape using bezier boolean union — no polygon conversion." -->

<!-- SCREENSHOT 3: The timeline panel with onion skinning active — previous frames in red, next frames in blue overlaid on the canvas. Caption: "Onion skinning with draggable range markers. Previous frames render red, next frames blue, with opacity falloff." -->

---

## Technical Deep Dive

If you want to know how the GPU SDF renderer works, why bezier booleans require double precision, or how the docking tree handles drag-and-drop restructuring — keep reading.

### Architecture

```
Spark (animation application)
    |
Kiln (30+ widget modules, vector engine, dock system)
    |
Clay (retained layout — sizing, positioning, scrolling, clipping)
    |
GLES3 / OpenGL 3.3 (rendering)
    |
SDL3 (windowing, input, pen pressure)
    |
FreeType (text shaping, glyph atlas)
```

{{< mermaid >}}
graph TD
    Spark[Spark Animation App] --> Kiln[Kiln GUI Framework]
    Kiln --> Clay[Clay Layout Engine]
    Kiln --> VectorEngine[Vector Path Engine]
    Kiln --> DockSys[Docking System]
    VectorEngine --> Bezier[Bezier Math]
    VectorEngine --> Boolean[Boolean Ops]
    VectorEngine --> SDF[GPU SDF Brush]
    VectorEngine --> Stencil[Stencil-and-Cover]
    Kiln --> GL[GLES3 Renderer]
    GL --> SDL3[SDL3 Windowing/Input]
    Kiln --> FT[FreeType Text]
{{< /mermaid >}}

The lifecycle is straightforward: `kiln_init()` creates the SDL3 window, GL context, Clay arena, and text atlas. Each frame calls `kiln_begin_frame()` (poll events, update input and Clay), user code declares layout and widgets, then `kiln_render_frame()` draws everything. `kiln_end_frame()` swaps buffers.

---

### Retained-Mode in C

Most C/C++ GUIs are immediate-mode (Dear ImGui) or widget-tree (GTK/Qt). Kiln uses **state-in-structs**: you declare the state, pass a pointer to the widget function, and Kiln reads and writes it across frames.

```c
KilnCheckboxState cb = { .checked = false };
kiln_checkbox("Option A", &cb);   // cb.checked changes on click
```

The caller owns the state — serialize it, undo it, share it between windows, inspect it without calling into the framework. Widget functions are pure: read input, check state, emit Clay layout, return.

Clay handles retained layout (sizing, positioning, scrolling, clipping). Kiln provides widget behavior, text shaping, and rendering on top. The separation keeps both layers testable and replaceable.

The framework grew to 30+ widget types: buttons, toggles, sliders, checkboxes, radios, progress bars, dropdowns, number inputs, tabs, panels, splits, grids, modals, menus, tree views, tables, color pickers, and a text input with clipboard, undo/redo, and double/triple-click select.

---

### Vector Path Engine

The Flash brush tool takes a freehand stroke and turns it into a filled shape that merges with neighboring strokes. That requires bezier math, boolean operations on curves, and resolution-independent rendering — all without polygon tessellation.

**Stroke-to-fill conversion** turns a centerline polyline plus width into a closed outline path. The variable-width version interpolates radii between endpoints for pen pressure:

```c
KilnPath *fill = kiln_path_stroke_to_fill_variable(centerline, radii, count);
```

**Boolean operations** use Bezier clipping (Sederberg & Nishita, 1990) for curve-curve intersection. The algorithm recursively subdivides at parameter values where curves cross, then reconstructs the boundary — all in bezier form, no polygon conversion at any stage.

```c
KilnPath *merged = kiln_path_boolean(stroke_a, stroke_b, UNION);
KilnPath *clean  = kiln_path_self_union(stroke);  // resolve self-crossings
```

All geometry uses double precision — single-precision errors accumulate in the recursive clipping and produce visible gaps in the merged silhouette.

**Stencil-and-cover rendering** draws the path once to invert the stencil, then covers. Bezier segments flatten at render time based on current zoom, so the result is resolution-independent. No tessellation, no intermediate mesh.

---

### GPU SDF Brush Renderer

The stencil pipeline works for arbitrary vector paths but struggles with brush strokes at high zoom — re-flattening produces thousands of line segments, and variable-width boolean merges are expensive to recompute every frame.

The SDF pipeline keeps strokes as **centerline cubics plus per-endpoint radii** and evaluates them as signed distance fields on the GPU:

```
Pen input → Chaikin smooth → Schneider bezier fit →
  centerline cubics + radii →
    GPU: cubic-to-quadratic approximation → R16F FBO with GL_MIN blend →
      compositing where SDF < 0
```

Each stroke renders into an R16F framebuffer as a quadratic bezier SDF. Multiple strokes in the same color group use **GL_MIN blending** — `min(SDF_a, SDF_b)` is the boolean union of two shapes. A final compositing pass fills pixels where accumulated SDF < 0, with smoothstep antialiasing.

```c
kiln_sdf_begin_group(color, alpha);
  kiln_sdf_stroke(cubics, radii, count);
  kiln_sdf_stroke(cubics, radii, count);
kiln_sdf_end_group();
```

Advantages over stencil-and-cover: no CPU boolean computation, variable width is free, resolution-independent, and onion skinning is just a color change in `kiln_sdf_begin_group`.

---

### Docking Workspace

The workspace is a binary-tree docking system. Split nodes hold a direction and ratio; leaf nodes hold tab groups.

```
        Split H (0.7)
       /              \
  Leaf (viewport)   Split V (0.5)
                     /           \
                Leaf (layers)  Leaf (properties)
```

Panels register a draw callback:

```c
KilnDockPanelId vp = kiln_dock_register_panel(&dock, "Viewport", draw_viewport, NULL);
KilnDockNodeId leaf_vp = kiln_dock_add_leaf(&dock, vp);
```

Panels drag between tabs, detach as floating windows, or re-dock into five drop zones (center, top, right, bottom, left). The drag system reads `Clay_GetElementData()` to find the target node's bounding box, computes which zone the cursor occupies, and restructures the tree on drop. Empty nodes clean up automatically.

---

### Spark: Animation Application

**Drawing tools:** Select, Rect, Oval, Line, Pen, and Brush. The brush pipeline runs: distance-based sampling → Chaikin corner-cutting → Schneider bezier fitting (Graphics Gems 1990) → variable-width stroke-to-fill → boolean merge with existing brush shapes on the same layer and frame.

**Timeline:** 16 layers × 300 frames. Three frame types: empty (inherits previous keyframe), keyframe (solid dot), blank keyframe (breaks continuity). Playhead advances with an accumulator at configurable FPS. Color-coded grid — blue for playhead, green for keyframes, darker ticks at 5-frame intervals. Space to play/stop, arrows to step, F6 to toggle keyframe.

**Undo/redo:** Command-pattern ring buffer, 256 entries, 10 command types. Deep copies for create/destroy (ownership transfer), delta-based for move. Platform-aware shortcuts (⌘ on macOS, Ctrl elsewhere).

**File I/O:** `.spark` JSON files storing version, stage dimensions, timeline structure, and full shape geometry including bezier contour data. Export to PPM via `glReadPixels`.
