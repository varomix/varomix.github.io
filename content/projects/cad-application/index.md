---
title: "OhCAD — Parametric CAD Kernel in Odin"
description: "A parametric CAD system built from scratch using OpenCASCADE and SolveSpace. Created to explore constraint solving, geometric modeling, boolean operations, and the architecture of modern engineering software."
tech: ["Odin", "SDL3", "Metal", "OpenCASCADE", "SolveSpace", "Metal Shading Language"]
featured: true
weight: 4
---

## What Is It?

OhCAD is a parametric CAD application — think Fusion 360 or SolidWorks, but built from scratch in Odin and running on a custom SDL3 GPU renderer. You sketch 2D shapes on a workplane, apply geometric constraints (horizontal, vertical, coincident, dimensioned distances), extrude them into 3D solids, and cut or combine those solids with boolean operations.

What makes it notable is that everything below the UI is hand-built. The constraint solver integrates SolveSpace's Levenberg-Marquardt engine through Odin's FFI. The boolean kernel wraps OpenCascade Technology (the same library inside FreeCAD and KiCad) behind a C wrapper. The renderer runs on SDL3 GPU with Metal shaders. The UI is a custom immediate-mode system drawn through the same graphics pipeline. There is no off-the-shelf CAD kernel, no Unity, no Unreal — just Odin linking against two C and C++ libraries and doing the rest itself.

## Why Did I Build It?

I'd spent years using CAD tools without really understanding what happened between clicking "Extrude" and seeing a solid appear. The constraint solver, the boundary representation, the boolean cut — these are algorithms that engineering teams spend careers on, and I wanted to see how far one person could get recreating them from scratch. The deeper motivation was practical: I was building creative tools (compositors, game frameworks) and kept hitting problems that CAD kernels already solved. Building OhCAD was a way to understand those solutions well enough to use them intentionally in other projects.

## What Did I Learn?

**Wrapping C++ from a systems language is more work than writing the algorithm yourself.** OpenCASCADE is a C++ library with deep template hierarchies, reference-counted handles, and exception-based error handling. Exposing it to Odin through a C wrapper meant writing an intermediate layer that translates `TopoDS_Shape` handles into opaque pointers, catches exceptions, and converts them to error codes. The wrapper (`occt_c_wrapper.cpp`) is about 400 lines, but every new operation — extrude, cut, revolve — requires a new C function, a new Odin binding, and a new error path. For a solo project, the binding tax is real. If I started over, I'd consider a simpler B-rep library or even implementing half-edge mesh operations directly in Odin.

**The constraint solver is the hardest algorithm I've ever integrated.** SolveSpace's libslvs uses the Levenberg-Marquardt algorithm to solve systems of nonlinear equations. It works, but diagnosing a failed solve is opaque — the solver returns "didn't converge" with no indication of which constraint is contradictory. I spent days on a sketch that wouldn't solve before realizing I'd accidentally defined both a horizontal constraint and a parallel-to-horizontal constraint on the same line. The fix was adding constraint validation that runs before the solver: detecting exact duplicates, redundant parallel-with-coincident combinations, and over-constrained subgraphs by analyzing the constraint graph's degrees of freedom.

**Double precision everywhere is non-negotiable for CAD, but it makes the GPU path awkward.** All geometric math uses `f64` with a tolerance of 1e-9. The GPU, naturally, wants `f32`. Every frame I upload `f64` matrices to a uniform buffer, convert them to `f32` in a Metal compute shader, and pass the result to the vertex shader. It works, but the conversion pass costs about 0.15ms per frame on M-series hardware — noticeable when you're trying to hit 120 FPS for smooth orbit interactions. A future version could skip the conversion by storing the projection matrix in `f32` and only keeping model transforms in `f64`.

**Immediate-mode UI is fast to build and miserable to extend.** The UI framework writes out panels as Odin functions that return the height used. Adding a button is one function call. Adding a resizable, dockable panel with save/restore layout? That's a month of work. For a tech demo of the CAD kernel, immediate-mode was the right call — I spent my time on geometry instead of widgets. But if this ever became a daily-driver tool, I'd switch to a retained-mode UI library before adding any more features.

**A 50-state undo/redo system sounds simple until you serialize GPU state.** The command history stores snapshots of the sketch, the feature tree, and the constraint state. It does not store the GPU vertex buffers — those are rebuilt from the feature tree on every undo. This means undo is fast (just restore the feature tree), but the first frame after undo has a visible hitch as the tessellation regenerates. A better approach would cache the last N tessellations and regenerate only when the cache misses.

## Key Results

| Metric | Value |
|---|---|
| **Constraint solver** | Levenberg-Marquardt via SolveSpace libslvs, 12 constraint types |
| **Boolean kernel** | OpenCascade Technology (OCCT) — same engine as FreeCAD and KiCad |
| **Precision** | Double-precision (`f64`) with 1e-9 tolerance throughout |
| **Solver validation** | Pre-solve constraint graph analysis for redundancy and contradiction detection |
| **Renderer** | SDL3 GPU with Metal backend — line, wireframe, and shaded pipelines |
| **UI framework** | Custom immediate-mode GPU-rendered widget toolkit |
| **Undo/redo** | 50-state command history with feature-tree snapshots |
| **3D features** | Extrude, boolean cut, revolve, primitives (box, cylinder, sphere, cone, torus) |
| **Test packages** | 5 (math, geometry, solver, topology, tessellation) |
| **Export** | STL for 3D printing |
| **Build time** | < 3 seconds |
| **Language** | Odin + C (OCCT wrapper) + Metal Shading Language |

## Screenshots / Media

<!-- SCREENSHOT 1: The OhCAD window showing a 2D sketch with geometric constraints displayed as labels (H, V, D) on lines and circles, the constraint toolbar on the left, and the properties panel on the right. Caption: "2D parametric sketcher with live constraint visualization — horizontal, vertical, distance, and coincident constraints rendered as labeled overlays." -->
<!-- SCREENSHOT 2: A 3D viewport showing an extruded solid with the feature tree panel displaying the sketch → extrude → cut dependency chain. Caption: "Feature tree showing parametric dependency chain — modifying the base sketch automatically marks downstream extrude and cut features for regeneration." -->
<!-- SCREENSHOT 3: Before/after of a boolean subtract operation — a cylinder cut through a box with the resulting cavity visible in wireframe overlay. Caption: "Boolean cut via OpenCASCADE — the cylinder is subtracted from the box, and the resulting B-rep is tessellated for GPU rendering." -->

## Technical Deep Dive

For the engineers wondering how a CAD application works under the hood — here is the architecture, the integration seams, and the algorithms that took the longest to get right.

### Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│  UI Layer                                            │
│  Immediate-mode panels: toolbar, properties,         │
│  feature tree, status bar, 3D viewport               │
│  (Odin + SDL3 GPU render pass)                        │
└──────────────────────┬──────────────────────────────┘
                       │ calls
┌──────────────────────▼──────────────────────────────┐
│  Feature Layer                                       │
│  Sketch2D, Extrude, Cut, Revolve, Primitives         │
│  Parametric dependency graph + 50-state undo/redo    │
└──────────────────────┬──────────────────────────────┘
                       │ uses
┌──────────────────────▼──────────────────────────────┐
│  Core Layer                                          │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────┐  │
│  │ Math     │  │ Solver   │  │ Geometry/Topology  │  │
│  │ (f64,    │  │ (libslvs │  │ (OCCT C wrapper)   │  │
│  │ toler-   │  │ FFI)     │  │ B-rep handles,     │  │
│  │ ances)   │  │          │  │ boolean ops        │  │
│  └──────────┘  └──────────┘  └───────────────────┘  │
└─────────────────────────────────────────────────────┘
```

The core layer has zero Odin standard library dependencies beyond `math` and `mem`. It can be compiled and tested independently of the UI.

### Constraint Solver Integration

The sketch solver bridges Odin and SolveSpace's libslvs through a thin FFI layer. The key data flow:

```odin
solve_sketch_2d :: proc(s: ^Sketch2D) -> SolveResult {
    solver.Slvs_ClearSketch()
    mapping, mapping_ok := convert_sketch_to_slvs(s)
    if !mapping_ok {
        return {success = false, error_message = "Constraint validation failed"}
    }

    solve_res := solver.Slvs_SolveSketch(mapping.group, nil)
    switch solve_res.result {
    case SLVS_RESULT_OKAY, SLVS_RESULT_REDUNDANT_OKAY:
        update_sketch_from_slvs(s, &mapping)
        return {success = true, dof = int(solve_res.dof)}
    case SLVS_RESULT_INCONSISTENT:
        return {success = false, error_message = "Inconsistent constraints"}
    case SLVS_RESULT_DIDNT_CONVERGE:
        return {success = false, error_message = "Did not converge"}
    }
}
```

The `convert_sketch_to_slvs` function maps OhCAD's internal entity representation to libslvs parameters and equations. Each sketch point becomes three Slvs parameters (x, y, in-plane), each constraint becomes a Slvs constraint type. The mapping is bidirectional — after solving, results are copied back into the OhCAD sketch.

The constraint validation step (which I added after the over-constraint bug) walks the constraint graph before solving:

```odin
validate_constraints :: proc(s: ^Sketch2D) -> bool {
    // Check for exact duplicate constraints
    // Check for redundant combinations (horizontal + parallel-to-horizontal)
    // Check for over-constrained subgraphs by counting DOF
    // Returns false + error message if validation fails
}
```

### The OCCT C Wrapper

OpenCASCADE is a C++ library, and Odin's FFI targets C ABI. The bridge layer (`occt_c_wrapper.cpp`) exposes a small C API that Odin can link against:

```cpp
extern "C" {
    ShapeHandle occt_make_extrusion(WireHandle wire, double depth) {
        try {
            BRepPrimAPI_MakePrism prism(TopoDS::Wire(*wire), gp_Vec(0, 0, depth));
            prism.Build();
            return new TopoDS_Solid(prism.Solid());
        } catch (Standard_Failure &e) {
            return nullptr;  // Odin checks for null
        }
    }

    ShapeHandle occt_boolean_cut(ShapeHandle base, ShapeHandle tool) {
        try {
            TopoDS_Shape result = BRepAlgoAPI_Cut(
                TopoDS::Solid(*base), TopoDS::Solid(*tool)
            );
            return new TopoDS_Shape(result);
        } catch (Standard_Failure &e) {
            return nullptr;
        }
    }
}
```

Every OCCT operation follows this pattern: wrap exceptions, return opaque handles, let Odin manage the handle lifetimes. The tessellation path converts B-rep shapes to triangle meshes for GPU rendering using OCCT's `BRepMesh_IncrementalMesh`.

### GPU Rendering Pipeline

Three pipelines run on SDL3 GPU, all compiled from embedded Metal Shading Language sources:

1. **Line pipeline** — sketch entities, grid lines, axes. Draws unlit colored lines with 1px width.
2. **Wireframe pipeline** — 3D edge overlay on extruded solids. Uses the depth buffer to show only visible edges.
3. **Shaded pipeline** — solid triangle rendering with a 50% ambient + 50% directional lighting model, tuned for technical visualization (no harsh shadows, clear edge definition).

The lighting model is intentionally simple — CAD visualization prioritizes shape clarity over realism:

```metal
fragment float4 triangle_fragment_main(
    TriangleVertexOut in [[stage_in]],
    constant TriangleUniforms& uniforms [[buffer(0)]]
) {
    float3 ambient = 0.50 * uniforms.baseColor.rgb;
    float3 lightDir = normalize(-uniforms.lightDir);
    float diffuseStrength = max(dot(normalize(in.normal), lightDir), 0.0);
    float3 diffuse = diffuseStrength * uniforms.baseColor.rgb * 0.50;
    return float4(ambient + diffuse, uniforms.baseColor.a);
}
```

The 2D/3D pass stacking works by running the 3D pass first (clearing both color and depth), then loading the existing color buffer for the 2D overlay with alpha blending and no depth test.

### Immediate-Mode UI Internals

The UI framework follows a classic immediate-mode pattern. A `UIContext` struct holds the hot/active widget IDs, mouse state, and style configuration. Every panel is a function that receives the context, positions widgets, and returns the height consumed:

```odin
ui_toolbar_panel :: proc(ctx: ^UIContext, cad_state: ^CADUIState,
                          sk: ^Sketch2D, x, y, width: f32) -> f32 {
    ui_section_box(ctx, x, y, width, 40,
        "SKETCH TOOLS", {0, 200, 200, 255}, {0, 200, 200, 255})

    for tool in sketch_tools {
        if ui_tool_icon(ctx, icon_x, icon_y, 56, tool.abbrev, tool.color,
                        sk.current_tool == tool.tool) {
            sketch_set_tool(sk, tool.tool)
        }
    }
    return total_height
}
```

The `ui_text_button` widget demonstrates the core pattern — hover detection, click state, color transitions, and a boolean return for "was clicked this frame":

```odin
ui_text_button :: proc(ctx: ^UIContext, x, y, width, height: f32, text: string) -> bool {
    id := ui_gen_id(ctx)
    is_hot := point_in_rect(ctx.mouse_x, ctx.mouse_y, x, y, width, height)

    if is_hot {
        ctx.mouse_over_ui = true
        ctx.hot_id = id
        if ctx.mouse_down && ctx.active_id == 0 {
            ctx.active_id = id
        }
    }

    is_active := ctx.active_id == id
    clicked := is_active && ctx.mouse_clicked && ctx.hot_id == id

    bg_color := is_active ? ctx.style.bg_light
               : is_hot ? ctx.style.bg_medium_bright
               : ctx.style.bg_medium

    ui_render_rect(ctx, x, y, width, height, bg_color)
    ui_render_text(ctx, text, text_x, text_y, ctx.style.font_size_normal, ctx.style.text_primary)
    return clicked
}
```

All UI rendering goes through the same GPU pipeline — rectangles are textured quads using the 1×1 white texture with per-vertex tinting, text is drawn from a baked bitmap font atlas.
