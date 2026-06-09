---
title: "Kiln & Spark — A C GUI Framework and Flash-Style Animation Tool"
description: "A Flash-inspired 2D animation application and retained-mode GUI framework written in C. Built to explore the architecture of professional creative tools, including custom UI systems, vector graphics, GPU rendering, animation timelines, and pressure-sensitive drawing workflows."
tech: ["C", "SDL3", "OpenGL ES 3", "FreeType", "Clay"]
weight: 1
---

## Overview

Kiln and Spark are a retained-mode GUI framework and a Flash-inspired 2D animation application built entirely in C. The project was created to explore the architecture behind professional creative software, including custom UI frameworks, vector graphics, GPU rendering, animation timelines, and digital drawing tools.

Rather than relying on existing application frameworks, Kiln provides the foundation for complex desktop applications with docking workspaces, custom widgets, text rendering, and undo/redo support. Spark demonstrates the framework in practice through a complete animation workflow featuring vector drawing, pressure-sensitive brushes, keyframe animation, onion skinning, and a multi-panel production interface.

---

## Architecture

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

Clay handles retained layout automatically — sizing, positioning, scrolling, clipping. Kiln provides widget behavior, text shaping, and rendering on top.

---

## Retained-Mode in C

Most C/C++ GUIs are immediate-mode (Dear ImGui) or widget-tree (GTK/Qt). Kiln takes a different approach: **state-in-structs**. You declare the state, pass a pointer to the widget function, and Kiln reads and writes it across frames:

```c
KilnCheckboxState cb = { .checked = false };
kiln_checkbox("Option A", &cb);   // cb.checked changes on click
```

The caller owns the state — you can serialize it, undo it, share it between windows, or inspect it without calling into the framework. Widget functions are pure: they read input, check their state, emit Clay layout, and return.

Clay handles the retained layout engine, while Kiln provides the widget behavior. The separation works well: Clay manages layout computation while Kiln handles widget logic, text shaping, and rendering.

The framework grew to 30+ widget types across the usual categories — buttons, toggles, sliders, checkboxes, radios, progress bars, dropdowns, number inputs, tabs, panels, splits, grids, modals, menus, tree views, tables, color pickers, and a text input with clipboard, undo/redo, and double/triple-click select.

The three systems that make Spark possible are the vector path engine, the SDF brush renderer, and the docking workspace.

---

## Vector Path Engine

The brush tool in Flash takes a freehand stroke and turns it into a filled shape that can merge with other strokes. This requires bezier math, boolean operations on curves, and resolution-independent rendering — all without polygon tessellation.

### Bezier Math

Paths are arrays of cubic bezier contours. The library provides eval, split, bounds, tangents, normals, arc length, inflection finding, and adaptive flattening via de Casteljau subdivision.

Two operations are critical for the brush pipeline:

**Stroke-to-fill conversion** turns a centerline polyline plus width into a closed outline path. The uniform-width version offsets each segment and adds round caps and joins. The variable-width version interpolates radii between endpoints for pen pressure:

```c
// Centerline as a path, radii at each endpoint
KilnPath *fill = kiln_path_stroke_to_fill_variable(centerline, radii, count);
```

**Winding number** and **point containment** via cubic root finding — used for hit-testing brush shapes on the stage.

### Boolean Operations

When two brush strokes overlap, Flash merges them into a single shape. Doing this with polygons is straightforward (Clipper2, libtess2). Doing it with bezier curves is not.

The implementation uses **Bezier clipping** (Sederberg & Nishita, 1990) for curve-curve intersection. Given two bezier curves, it recursively subdivides at parameter values where they cross, producing a list of intersection parameters. From these, the boolean engine reconstructs the boundary of the union, intersection, or difference — all in bezier form, no polygon conversion at any stage.

```c
KilnPath *merged = kiln_path_boolean(stroke_a, stroke_b, UNION);
KilnPath *clean  = kiln_path_self_union(stroke);  // resolve self-crossings
```

All geometry uses double precision — single-precision errors accumulate in the recursive clipping and produce visible gaps in the merged silhouette.

### Stencil-and-Cover Rendering

The merged paths render via the stencil buffer with the non-zero winding rule: draw the path once to invert the stencil, then cover. Since bezier segments are flattened at render time based on current zoom, the result is resolution-independent — zooming in produces smoother curves, not larger pixels. No polygon tessellation or intermediate representation is needed.

---

## GPU SDF Brush Renderer

The stencil-and-cover pipeline works for vector paths but has a problem with brush strokes: re-flattening every frame at high zoom produces thousands of line segments, and the boolean merge for variable-width strokes is expensive to recompute.

The SDF pipeline takes a different approach. Instead of computing the filled outline, it keeps brush strokes as **centerline cubics plus per-endpoint radii** and evaluates them as signed distance fields on the GPU:

```
Pen input → Chaikin smooth → Schneider bezier fit →
  centerline cubics + radii →
    GPU: cubic-to-quadratic approximation → R16F FBO with GL_MIN blend →
      compositing where SDF < 0
```

Each stroke renders into an R16F framebuffer as a quadratic bezier SDF via the fragment shader. Multiple strokes in the same color group use **GL_MIN blending** — `min(SDF_a, SDF_b)` is the boolean union of the two shapes. A final compositing pass fills pixels where the accumulated SDF < 0 with smoothstep antialiasing.

```c
kiln_sdf_begin_group(1.0f, 0.2f, 0.2f, 1.0f);
for each stroke {
    kiln_sdf_draw_stroke(cubic_segs, seg_count, radii, radii_count, tx, ty, zoom);
}
kiln_sdf_end_group();
```

Advantages over the stencil pipeline:

- **No CPU boolean computation** — merging happens on GPU via blend mode
- **Variable width is free** — radii are per-endpoint, the SDF evaluates distance to the varying-width stroke implicitly
- **Resolution-independent** — the SDF is evaluated at pixel resolution each frame
- **Onion skinning** — just change the compositing color to red or blue with reduced alpha

Hit-testing on the CPU side uses the same SDF math — evaluate the minimum distance from a point to all cubic segments weighted by the radii at the nearest point.

---

## Docking Workspace

Spark's workspace — toolbar, canvas, properties, timeline — is built on a binary-tree docking system (`kiln_dock.c`). The tree consists of split nodes (horizontal or vertical with a ratio) and leaf nodes (tab groups):

```
        Split H (0.7)
       /              \
  Leaf (viewport)   Split V (0.5)
                     /           \
                Leaf (layers)  Leaf (properties)
```

Panels register a draw callback and get added to the tree:

```c
KilnDockPanelId vp = kiln_dock_register_panel(&dock, "Viewport", draw_viewport, NULL);
KilnDockNodeId leaf_vp = kiln_dock_add_leaf(&dock, vp);
```

Tab groups hold up to 8 panels per leaf. Panels can be dragged between tabs, detached as floating windows, or re-docked into any of five drop zones (center, top, right, bottom, left). The viewport is marked as the central node and cannot be closed.

The drag system reads `Clay_GetElementData()` to find the target node's bounding box, computes which zone the cursor occupies, and restructures the tree on drop. Empty nodes are cleaned up automatically — when the last tab is dragged out of a leaf, the leaf is removed and the split tree collapses.

---

## Spark

Spark is a Flash CC-style animation application built on Kiln. It uses every part of the framework: the canvas widget for the stage, the dock for the workspace layout, the menu bar for file/edit/view menus, panels for properties and timeline, the color picker for fill/stroke colors, number inputs for transform values, and the vector and SDF engines for drawing.

### Drawing

Six tools on the toolbar: Select, Rect, Oval, Line, Pen, and Brush. All shapes store their geometry in world space:

- **Rect/Oval**: Bounding-box shapes, drawn as filled polys or outlined via the line shader
- **Line**: Two endpoints, Shift snaps to 45°
- **Pen**: Click-to-add-point polyline with rubber-band preview, finalized on double-click or Escape
- **Brush**: Freehand strokes with SDL3 pen pressure capture — each point records pressure as a radius

The brush tool runs through: distance-based sampling of raw pen input → Chaikin corner-cutting for smooth centerlines → Schneider bezier fitting (Graphics Gems 1990) to produce compact cubic segments → variable-width stroke-to-fill → boolean merge with existing brush shapes on the same layer and frame.

### Timeline

16 layers × 300 frames with three frame types: empty (inherits previous keyframe), keyframe (solid), and blank keyframe (breaks continuity). The playhead advances at configurable FPS with an accumulator, and the timeline UI renders a frame grid with color-coded cells — blue for playhead, green for keyframes, darker at 5-frame intervals.

Layer operations: add, delete, rename, toggle visibility, lock. Keyboard shortcuts: Space for play/stop, arrows for frame stepping, F6 for keyframe toggle.

### Onion Skinning

Toggle onion skinning to see previous and next frames overlaid on the current frame. Two draggable range markers on the playhead track control how many frames before and after are visible. Previous frames render with a red tint, next frames with blue, with opacity falling off by distance from the playhead.

For SDF brush shapes, onion skinning is just a different color in `kiln_sdf_begin_group`. For rect, oval, and line shapes, the existing shaders take a tinted color. The canvas render pass sorts by layer, then by frame distance from playhead, so onion skins always appear behind current-frame content.

### Undo/Redo

Command-pattern undo with a 256-entry ring buffer covering 10 command types: create/destroy/move shape, merge brush, keyframe operations, add/delete/rename layer. Deep copies for shape creation and deletion (ownership transfer), delta-based for move operations. Platform-aware shortcuts (⌘ on macOS, Ctrl elsewhere).

### File I/O

Project files are JSON with a `.spark` extension, storing version, stage dimensions, timeline (layers, keyframes, FPS), and all shapes with their geometry, fill/stroke colors, layer/frame placement, and bezier contour data for brush paths. Loading parses the JSON and restores the full document state including undo history (cleared on new/open). Export to PPM via `glReadPixels` for frame-level output.

---

## Key Results

| | |
|---|---|
| **Language** | C (C11) |
| **Widget types** | 30+ across buttons, inputs, containers, data displays |
| **Vector path engine** | Bezier math, boolean ops, stencil-and-cover rendering |
| **SDF brush pipeline** | R16F FBO, GL_MIN blend, quadratic bezier SDF |
| **Docking system** | Binary tree, drag-and-drop, 64 max nodes, auto-clean |
| **Drawing tools** | 6 (Select, Rect, Oval, Line, Pen, Brush) |
| **Timeline** | 16 layers × 300 frames |
| **Pen pressure** | SDL3 pen API, per-point radius |
| **Undo/redo** | 256-entry ring buffer, 10 command types |
| **Onion skinning** | Draggable range, red/blue tint, opacity falloff |
| **Text** | FreeType, UTF-8 Unicode atlas, on-demand rasterization |
| **Tests** | 53 passing across bezier math, boolean ops, and bezier fitting |
| **Build** | `cmake -B build && cmake --build build` — 0 errors, 0 warnings |

---

## What I Learned

**1. Bezier boolean operations are deceptively hard.** The Bezier clipping algorithm is elegant on paper, but edge cases multiply fast — tangential intersections, overlapping segments, curve-curve coincidence at endpoints, self-crossing paths with multiple intersection pairs at the same parameter. Getting all four boolean operations (union, intersect, difference, XOR) working reliably took more iteration than the rest of the vector engine combined.

**2. The SDF pipeline was the right call, but I should have started there.** The stencil-and-cover renderer works and is more general, but the SDF brush renderer is faster, handles variable width for free, and makes onion skinning trivial. If I were starting over, I would build the SDF path first and only add stencil-and-cover for the cases SDF cannot handle (arbitrary filled paths with holes).

**3. Clay's retained layout is the right foundation, but the imperative API is necessary.** The Clay macro API auto-closes containers, which breaks any widget that needs user content nested inside. Every complex widget — tabs, panels, menus, docking — had to switch to Clay's imperative `Clay__OpenElementWithId` / `Clay__CloseElement` API. This pattern repeated across four milestones.

**4. Caller-owned state simplifies undo.** Because every widget's state lives in a struct owned by the application, undo just snapshots those structs. No framework-level undo stack, no widget state serialization, no hidden framework state that needs to be recreated.

**5. SDL3's pen API is well-designed.** The SDL3 pen API (`SDL_EVENT_PEN_*`) provides position, pressure, tilt, rotation, and barrel state from any compatible tablet. The harder problem was making the brush pipeline fast enough to keep up with 120 Hz pen input while performing bezier fitting and boolean operations in real time.

---

## What I'd Do Differently

- **Build the SDF brush renderer first.** The stencil-and-cover pipeline was the obvious first approach, but the SDF pipeline replaced most of it. The extra complexity of maintaining two parallel rendering paths is not justified.
- **Build the dock system earlier.** Adding docking late meant retrofitting all the existing panels. If the dock had been the first container widget, everything else would have slotted into it naturally.
- **Add stb_image from day one.** The image loading module is still a stub because adding it requires modifying the renderer and build system. Doing it early would have avoided the limitation of text-only toolbar icons.

---

## Current Status

The framework is mature enough to support a professional animation tool. Spark demonstrates the full stack: a retained-mode GUI with 30+ widgets, a bezier-native vector engine with boolean operations and stencil rendering, a GPU SDF brush pipeline with GL_MIN merging, and a docking workspace — all in C with no external runtime dependencies beyond SDL3, GLES3, FreeType, and Clay.

Future work includes PNG export (replacing PPM), a file dialog, multi-object selection, live property editing (number inputs update shape geometry in real time), tweening between keyframes, and sprite sheet/animated GIF export.
