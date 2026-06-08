---
title: "Kiln & Spark — A C GUI Framework and Flash-Style Animation Tool"
description: "A retained-mode C GUI framework (Kiln) and a Flash CC-style 2D animation application (Spark) built on Clay, SDL3, GLES3, and FreeType — with 30+ widgets, a bezier-native vector path engine, GPU SDF brush rendering, binary-tree docking, and full animation tooling."
tech: ["C", "SDL3", "OpenGL ES 3", "FreeType", "Clay"]
weight: 1
---

## Overview

Kiln is a **retained-mode C GUI framework** — widget state lives in persistent structs, not in a per-frame API like Dear ImGui. It sits on **Clay** for layout, **SDL3** for windowing and input, **GLES3** for rendering, and **FreeType** for text.

**Spark** is the reason Kiln exists — a Flash CC-style 2D animation application that needs all of it: a canvas with pan/zoom, drawing tools with pen pressure, a timeline with keyframes, onion skinning, a docking workspace, and a vector brush pipeline that can booleans-merge overlapping strokes into clean silhouettes the way Flash/Animate does.

{{< video-placeholder "Spark workspace — brush drawing with pen pressure, timeline playback, and onion skinning" >}}

---

## Retained-Mode in C

Most C/C++ GUIs are immediate-mode (Dear ImGui) or widget-tree (GTK/Qt). Kiln takes a different path: **state-in-structs**. You declare the state, pass a pointer to the widget function, and Kiln reads/writes it across frames:

```c
KilnCheckboxState cb = { .checked = false };
kiln_checkbox("Option A", &cb);   // cb.checked changes on click
```

This means the caller owns the state — you can serialize it, undo it, share it between windows, or inspect it without calling into the framework. The widget functions are pure: they read input, check their state, emit Clay layout, and return.

Clay handles the retained layout engine (sizing, positioning, scrolling, clipping), while Kiln provides the widget behavior on top. The separation works well: ~100 lines of Clay for layout, the rest is widget logic, text shaping, and rendering.

The framework grew to **30+ widget types** across the usual categories — buttons, toggles, sliders, checkboxes, radios, progress bars, dropdowns, number inputs, tabs, panels, splits, grids, modals, menus, tree views, tables, color pickers, and a text input with clipboard, undo/redo, and double/triple-click select.

But the interesting parts are the three systems that make Spark possible: the vector path engine, the SDF brush renderer, and the docking workspace.

---

## Vector Path Engine

The brush tool in Flash takes a freehand stroke and turns it into a filled shape that can merge with other strokes. Doing this well requires bezier math, boolean operations on curves, and resolution-independent rendering — all without polygon tessellation.

The engine is three files:

### Bezier Math (`kiln_bezpath.c`, ~900 lines)

Paths are arrays of cubic bezier contours. The library provides the usual: eval, split, bounds, tangents, normals, arc length, inflection finding, and adaptive flattening via de Casteljau subdivision.

Two operations are critical for the brush pipeline:

**Stroke-to-fill conversion** turns a centerline polyline + width into a closed outline path. The uniform-width version offsets each segment and adds round caps/joins. The variable-width version interpolates radii between endpoints:

```c
// Centerline as a path, radii at each endpoint
KilnPath *fill = kiln_path_stroke_to_fill_variable(centerline, radii, count);
```

**Winding number** and **point containment** via cubic root finding — used for hit-testing brush shapes on the stage.

### Boolean Operations (`kiln_bezbool.c`, ~900 lines)

When two brush strokes overlap, Flash merges them into a single shape. Doing this with polygons is straightforward (Clipper2, libtess2). Doing it with bezier curves is not.

The implementation uses **Bezier clipping** (Sederberg & Nishita, 1990) for curve-curve intersection. Given two bezier curves, it recursively subdivides at parameter values where they cross, producing a list of intersection parameters. From these, the boolean engine reconstructs the boundary of the union/intersection/difference.

```c
KilnPath *merged = kiln_path_boolean(stroke_a, stroke_b, UNION);
KilnPath *clean  = kiln_path_self_union(stroke);  // resolve self-crossings
```

All geometry uses double precision — single-precision errors accumulate in the recursive clipping and produce visible gaps in the merged silhouette.

### Stencil-and-Cover (`kiln_pathrender.c`, ~330 lines)

The merged paths render via the stencil buffer with the non-zero winding rule: draw the path once to invert the stencil, then cover. Since the bezier segments are flattened at render time based on current zoom, the result is resolution-independent — zooming in produces smoother curves, not bigger pixels.

No polygon tessellation. No intermediate representation. Bezier paths go from CPU to GPU through the stencil buffer directly.

{{< image-placeholder "Vector path rendering — boolean union of overlapping brush strokes into a single clean silhouette" >}}

---

## GPU SDF Brush Renderer

The stencil-and-cover pipeline works for vector paths but has a problem with brush strokes: re-flattening every frame at high zoom produces thousands of line segments, and the boolean merge for variable-width strokes is expensive to recompute.

The SDF pipeline takes a different approach. Instead of computing the filled outline, it keeps the brush strokes as **centerline cubics + per-endpoint radii** and evaluates them as signed distance fields on the GPU:

```
Pen input → Chaikin smooth → Schneider bezier fit →
  centerline cubics + radii →
    GPU: cubic→quadratic approximation → R16F FBO with GL_MIN blend →
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

The advantages over the stencil pipeline:
- **No CPU boolean computation** — merging happens on GPU via blend mode
- **Variable width is free** — radii are per-endpoint, SDF evaluates the distance to the varying-width stroke implicitly
- **Resolution-independent** — SDF is evaluated at pixel resolution every frame
- **Onion skinning** — just change the compositing color to red/blue with reduced alpha

Hit-testing on the CPU side uses the same SDF math — evaluate the minimum distance from a point to all cubic segments weighted by the radii at the nearest point.

{{< video-placeholder "SDF brush strokes with pen pressure — variable width, real-time merging, and onion skin overlay" >}}

---

## Docking Workspace

Spark's workspace — toolbar, canvas, properties, timeline — is built on a binary-tree docking system (`kiln_dock.c`). The tree internal is split nodes (horizontal or vertical with a ratio) and leaf nodes (tab groups):

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

The drag system reads `Clay_GetElementData()` to find the target node's bounding box, computes which zone the cursor is in, and restructures the tree on drop.

---

## Spark

Spark is a Flash CC-style animation application built on Kiln. It uses every part of the framework: the canvas widget for the stage, the dock for the workspace layout, the menu bar for file/edit/view menus, panels for properties and timeline, the color picker for fill/stroke colors, number inputs for transform values, and the vector/SDF engines for drawing.

### Drawing

Six tools on the toolbar: Select, Rect, Oval, Line, Pen, and Brush. All shapes store their geometry in world space and render through their respective pipeline:

- **Rect/Oval**: Simple bounding-box shapes, drawn as filled polys or outlined via the line shader
- **Line**: Two endpoints, Shift snaps to 45°
- **Pen**: Click-to-add-point polyline with rubber-band preview, finalized on double-click or Escape
- **Brush**: Freehand strokes with SDL3 pen pressure capture — each point records pressure as a radius

The brush tool runs through: distance-based sampling of raw pen input → Chaikin corner-cutting for smooth centerlines → Schneider bezier fitting (Graphics Gems 1990) to produce compact cubic segments → variable-width stroke-to-fill → boolean merge with existing brush shapes on the same layer/frame.

### Timeline

16 layers × 300 frames with three frame types: empty (inherits previous keyframe), keyframe (solid), and blank keyframe (breaks continuity). The playhead advances at configurable FPS with an accumulator, and the timeline UI renders a frame grid with color-coded cells — blue for playhead, green for keyframes, darker at 5-frame intervals.

Layer operations: add, delete, rename, toggle visibility, lock. Keyboard shortcuts: Space for play/stop, arrows for frame stepping, F6 for keyframe toggle.

### Onion Skinning

Toggle onion skinning to see previous/next frames overlaid on the current frame. Two draggable range markers on the playhead track control how many frames before and after are visible. Previous frames render with a red tint, next frames with blue, with opacity falling off by distance from the playhead.

For SDF brush shapes, onion skinning is just a different color in `kiln_sdf_begin_group`. For rect/oval/line shapes, the existing shaders take a tinted color. The canvas render pass sorts by layer, then by frame distance from playhead, so onion skins always appear behind current-frame content.

### Undo/Redo

Command-pattern undo with a 256-entry ring buffer covering 10 command types: create/destroy/move shape, merge brush, keyframe operations, add/delete/rename layer. Deep copies for shape creation and deletion (ownership transfer), delta-based for move operations. Platform-aware shortcuts (⌘ on macOS, Ctrl elsewhere).

### File I/O

Project files are JSON with a `.spark` extension, storing version, stage dimensions, timeline (layers, keyframes, FPS), and all shapes with their geometry, fill/stroke colors, layer/frame placement, and bezier contour data for brush paths. Loading parses the JSON and restores the full document state including undo history (cleared on new/open). Export to PPM via `glReadPixels` for frame-level output.

{{< image-placeholder "Spark full workspace — brush stroke on canvas, properties panel showing shape data, timeline with keyframes and onion skin range" >}}

---

## Key Results

| Metric | Value |
|---|---|
| **Language** | C (C11) |
| **Framework** | ~10,000 lines across 30+ source files |
| **Widget types** | 30+ |
| **Vector path engine** | ~2,130 lines (bezpath + bezbool + pathrender) |
| **SDF brush pipeline** | R16F FBO, GL_MIN blend, quadratic bezier SDF |
| **Docking system** | Binary tree, drag-and-drop, 64 max nodes |
| **Spark** | ~3,800 lines (spark.c + spark_draw.c) |
| **Drawing tools** | 6 (Select, Rect, Oval, Line, Pen, Brush) |
| **Timeline** | 16 layers × 300 frames |
| **Pen pressure** | SDL3 pen API, per-point radius |
| **Undo/redo** | 256-entry ring buffer, 10 command types |
| **Onion skinning** | Draggable range, red/blue tint, opacity falloff |
| **Text** | FreeType, UTF-8 Unicode atlas, on-demand rasterization |
| **Rendering** | GLES3 with custom draw callbacks |
| **Build** | `cmake -B build && cmake --build build` — 0 errors, 0 warnings |
| **Platform** | macOS, Linux, Windows |

---

## Current Status

The framework is mature enough to support a professional animation tool. Spark demonstrates the full stack: a retained-mode GUI with 30+ widgets, a bezier-native vector engine with boolean operations and stencil rendering, a GPU SDF brush pipeline with GL_MIN merging, and a docking workspace — all in C with no external runtime dependencies.

Future work includes PNG export (replacing PPM), a file dialog, multi-object selection, live property editing (number inputs update shape geometry in real time), tweening between keyframes, and sprite sheet/animated GIF export.
