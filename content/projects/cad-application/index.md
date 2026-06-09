---
title: "OhCAD — Parametric CAD Kernel in Odin"
description: "A parametric CAD system built from scratch using OpenCASCADE. Created to explore constraint solving, geometric modeling, and the architecture of modern engineering software."
tech: ["Odin", "SDL3", "Metal", "OpenCASCADE", "SolveSpace", "Metal Shading Language"]
featured: true
weight: 4
---

## Overview

**OhCAD** is a **parametric CAD application** built to explore the architecture and algorithms behind modern engineering software. Developed using OpenCASCADE, the project focuses on geometric modeling, constraint solving, feature-based design, and the challenges of creating professional-grade design tools from the ground up.

The application supports sketch-based workflows, parametric modeling, and interactive editing, providing a practical environment for investigating how CAD systems represent geometry, maintain design intent, and manage complex relationships between features. Through this project, I explored computational geometry, software architecture, and the engineering principles that power modern computer-aided design software.

<!-- TODO: add video/gif -->
{{< video-placeholder "OhCAD demo — sketching, extruding, and boolean cutting" >}}

---

## Architecture

OhCAD is organized into four layers:

```
src/
├── core/           # Math, geometry, topology, constraint solver bindings
│   ├── math/       # Double-precision CAD math (Vec3, Mat4, tolerances)
│   ├── solver/     # FFI bindings to SolveSpace (libslvs)
│   ├── geometry/   # OCCT C wrapper and Odin bindings
│   └── topology/   # B-rep handle-based data structures
├── features/       # Parametric features (sketch, extrude, cut, revolve)
│   ├── sketch/     # 2D sketcher, constraint solver integration, profile detection
│   ├── extrude/    # Extrude/pad feature
│   ├── cut/        # Boolean subtract via OCCT
│   ├── revolve/    # Revolve/shaft feature
│   └── feature_tree/ # Parametric dependency graph
├── io/             # STL export
└── ui/             # SDL3 GPU viewer, Metal shaders, widget toolkit
    ├── viewer/     # Camera, renderer, shader pipelines
    └── widgets/    # Toolbar, properties panel, feature tree, status bar
```

### Precision

All geometric computations use **double precision** (`f64`) with configurable tolerances:

```odin
// core/math/math.odin
Vec2 :: glsl.dvec2
Vec3 :: glsl.dvec3
Mat4 :: glsl.dmat4

DEFAULT_TOLERANCE :: 1e-9

Tolerance :: struct {
    linear: f64,
    angular: f64,
}

is_near :: proc{is_near_f64, is_near_vec2, is_near_vec3}

is_near_f64 :: proc(a, b: f64, eps: f64 = DEFAULT_TOLERANCE) -> bool {
    return math.abs(a - b) <= eps
}
```

<!-- TODO: insert image -->
{{< image-placeholder "Architecture diagram showing the four layers" >}}

---

## 2D Parametric Sketcher

The sketcher supports **lines, circles, and arcs** drawn interactively on a configurable workplane. Users select sketch entities and apply geometric constraints via the toolbar.

### Constraint Solver

OhCAD integrates **SolveSpace's libslvs** — an open-source geometric constraint solver — through Odin's FFI (foreign function interface). The solver uses the **Levenberg-Marquardt algorithm** to iteratively solve systems of nonlinear equations:

```odin
// core/solver/slvs_bindings.odin
Slvs_hParam      :: u32
Slvs_hEntity     :: u32
Slvs_hConstraint :: u32

SLVS_C_POINTS_COINCIDENT :: 100000
SLVS_C_PT_PT_DISTANCE    :: 100001
SLVS_C_HORIZONTAL        :: 100019
SLVS_C_VERTICAL          :: 100020
SLVS_C_PARALLEL          :: 100025
SLVS_C_PERPENDICULAR     :: 100026
```

The high-level solver converts OhCAD sketch entities into libslvs format, solves, and maps results back:

```odin
// features/sketch/constraint_solver.odin
solve_sketch_2d :: proc(s: ^Sketch2D) -> SolveResult {
    solver.Slvs_ClearSketch()
    mapping, mapping_ok := convert_sketch_to_slvs(s)
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

### Constraint Editing

Dimensions are editable inline — double-click a dimension constraint to open a text widget, type the new value, and the solver re-runs with live visual feedback.

<!-- TODO: insert image -->
{{< image-placeholder "2D sketch with constraints shown — horizontal, vertical, distance, and coincident" >}}

---

## 3D Extrusion & Boolean Operations

### Extrude

Closed sketch profiles are extruded into **3D solids** along the workplane normal. The extrusion creates both a tessellated mesh for rendering and an exact B-rep shape via OCCT:

```odin
// features/extrude/extrude.odin
extrude_sketch :: proc(sk: ^sketch.Sketch2D, params: ExtrudeParams) -> ExtrudeResult {
    profiles := sketch.sketch_detect_profiles(sk)
    closed_profile := find_closed_profile(profiles)

    // Create both mesh + B-rep
    solid := build_extruded_mesh(closed_profile, params.depth)
    occt_shape := occt.extrude_wire_to_solid(closed_profile, params.depth)

    return {occt_shape = occt_shape, solid = solid, success = true}
}
```

### Boolean Cut

**Boolean subtract** operations use **OpenCascade Technology (OCCT)** via a C wrapper. OCCT is the same CAD kernel used by FreeCAD and KiCad:

```odin
// features/cut/cut.odin
cut_sketch :: proc(sk: ^sketch.Sketch2D, params: CutParams) -> CutResult {
    occt_shape, solid := boolean_subtract_occt(sk, closed_profile, params)
    return {occt_shape = occt_shape, solid = solid, success = true}
}
```

The C wrapper layer bridges Odin and OCCT's C++ API:

```cpp
// core/geometry/occt/occt_c_wrapper.cpp
extern "C" {
    ShapeHandle occt_make_extrusion(WireHandle wire, double depth) {
        BRepPrimAPI_MakePrism prism(TopoDS::Wire(*wire), gp_Vec(0, 0, depth));
        prism.Build();
        return new TopoDS_Solid(prism.Solid());
    }

    ShapeHandle occt_boolean_cut(ShapeHandle base, ShapeHandle tool) {
        TopoDS_Shape result = BRepAlgoAPI_Cut(
            TopoDS::Solid(*base), TopoDS::Solid(*tool)
        );
        return new TopoDS_Shape(result);
    }
}
```

<!-- TODO: insert images -->
{{< image-placeholder "Before/after of a boolean cut operation" >}}
{{< image-placeholder "Multiple extruded solids in the viewport" >}}

---

## GPU Rendering

The viewer uses **SDL3 GPU** — a cross-platform GPU abstraction that currently targets **Metal** on macOS but can target **Vulkan**, **Direct3D 12**, or **OpenGL** via backend swap. Custom shaders written in **Metal Shading Language** handle both wireframe and shaded rendering with Phong-derived CAD lighting, and the SDL3 shader compilation layer means these could be ported to **GLSL** or **HLSL** with minimal changes to expand platform support:

```metal
// ui/viewer/shaders/triangle_shader.metal
struct TriangleUniforms {
    float4x4 mvp;
    float4x4 model;
    float4 baseColor;
    float3 lightDir;
    float ambientStrength;
};

vertex TriangleVertexOut triangle_vertex_main(
    TriangleVertexIn in [[stage_in]],
    constant TriangleUniforms& uniforms [[buffer(0)]]
) {
    TriangleVertexOut out;
    out.position = uniforms.mvp * float4(in.position, 1.0);
    out.normal = normalize((uniforms.model * float4(in.normal, 0.0)).xyz);
    return out;
}
```

The lighting model uses **50% ambient + 50% directional** — optimized for technical visualization with clear edge definition and no harsh shadows:

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

Three pipelines are maintained:
- **Line pipeline** — sketch entities, grid, axes
- **Wireframe pipeline** — 3D edge overlay with depth testing
- **Shaded pipeline** — solid triangles with CAD-optimized lighting

<!-- TODO: insert image -->
{{< image-placeholder "Screenshot of the 3D viewport with shaded solid and grid" >}}

---

## UI Framework

A custom **immediate-mode GUI** is built from scratch on top of SDL3 input handling, with all widgets rendered via the GPU pipeline. The UI follows a dark technical CAD aesthetic with cyan accents:

```odin
// ui/widgets/widgets.odin — UI context and style
UIContext :: struct {
    viewer:        ^v.ViewerGPU,
    text_renderer: ^v.TextRendererGPU,
    cmd:           ^sdl.GPUCommandBuffer,
    pass:          ^sdl.GPURenderPass,

    mouse_x, mouse_y: f32,
    mouse_down: bool,
    mouse_clicked: bool,

    hot_id: u64,      // Widget under mouse
    active_id: u64,   // Widget being clicked
    mouse_over_ui: bool,
}

UIStyle :: struct {
    bg_dark:   [4]u8,  // {20, 20, 25} — very dark gray
    bg_medium: [4]u8,  // {40, 45, 50} — medium gray
    bg_light:  [4]u8,  // {60, 65, 70} — lighter gray
    text_primary:   [4]u8,  // off-white
    accent_primary: [4]u8,  // cyan
}

ui_context_init :: proc(viewer, text_renderer) -> UIContext {
    return {viewer = viewer, text_renderer = text_renderer,
            style = ui_default_style()}
}

ui_begin_frame :: proc(ctx, cmd, pass, mouse_x, mouse_y, mouse_down) {
    ctx.mouse_clicked = !mouse_down && ctx.mouse_down
    ctx.mouse_down = mouse_down
    ctx.next_id = 1
    ctx.mouse_over_ui = false
}
```

Widgets are laid out in panels — every panel is a function that receives the `UIContext`, positions widgets, and returns the height used. Here is the **toolbar panel** with sketch tool icons:

```odin
// ui/widgets/cad_ui.odin — toolbar panel
ui_toolbar_panel :: proc(
    ctx: ^UIContext, cad_state: ^CADUIState,
    sk: ^sketch.Sketch2D,
    x, y, width: f32,
) -> f32 {
    ui_section_box(ctx, x, current_y, width, 40,
        "SKETCH TOOLS", {0, 200, 200, 255}, {0, 200, 200, 255})

    tools := []struct{ name, abbrev: string, tool: sketch.SketchTool, color: [4]u8 }{
        {"Select", "SL", .Select, {100, 150, 255, 255}},
        {"Line",   "LN", .Line,   {0, 255, 100, 255}},
        {"Circle", "CR", .Circle, {255, 180, 0, 255}},
        {"Arc",    "AR", .Arc,    {255, 100, 200, 255}},
        {"Dimension", "DM", .Dimension, {200, 200, 0, 255}},
    }
    for tool in tools {
        if ui_tool_icon(ctx, icon_x, icon_y, 56, tool.abbrev, tool.color,
                        sk.current_tool == tool.tool) {
            sketch.sketch_set_tool(sk, tool.tool)
        }
    }
}
```

The **solid toolbar** provides 3D modeling tools — New Sketch, Extrude, and primitives (Box, Cylinder, Sphere, Cone, Torus). Disabled tools (Fillet, Chamfer) are rendered gray:

```odin
// Solid toolbar with plane selector for sketch-on-face workflow
ui_solid_toolbar_panel :: proc(ctx, cad_state, x, y, width) -> f32 {
    tools := {
        {"New Sketch", "NS", 1, {0, 200, 220, 255}, true},
        {"Extrude",    "EX", 2, {0, 200, 100, 255}, true},
        {"Fillet",     "FT", 3, {150, 150, 150, 255}, false},  // disabled
        {"Chamfer",    "CH", 4, {150, 150, 150, 255}, false},  // disabled
        {"Box",     "BX", 5, {255, 180, 50, 255}, true},
        {"Cylinder","CY", 6, {255, 120, 180, 255}, true},
        {"Sphere",  "SP", 7, {120, 200, 255, 255}, true},
        {"Cone",    "CN", 8, {200, 150, 255, 255}, true},
        {"Torus",   "TR", 9, {255, 220, 100, 255}, true},
    }
    for tool in tools {
        if ui_tool_icon(ctx, ...) && tool.enabled {
            if tool.id == 1 {
                if cad_state.selected_feature_id >= 0 {
                    cad_state.create_sketch_on_face = true  // sketch-on-face
                } else {
                    cad_state.show_plane_selector = !cad_state.show_plane_selector
                }
            }
        }
    }
}
```

The **properties panel** shows selected constraint details and provides editable numeric steppers for dimension values:

```odin
// Properties panel with constraint editing
if sk.selected_constraint_id >= 0 {
    constraint := sketch.sketch_get_constraint(sk, sk.selected_constraint_id)

    ui_text_input(ctx, x, y, width, 28, "TYPE", constraint_type_str)

    value, has_value := sketch.sketch_get_constraint_value(sk, sk.selected_constraint_id)
    if has_value {
        if ui_numeric_stepper(ctx, x, y, width, 28, "DISTANCE",
                              &cad_state.temp_constraint_value, 0.1, 0.1, 999.0) {
            sketch.sketch_modify_constraint_value(sk, id, f64(cad_state.temp_constraint_value))
            sketch.sketch_solve_constraints(sk)  // re-solve with new value
        }
    }

    // Delete constraint button
    if ui_button(ctx, x, y, width, 28, "Delete Constraint",
                 {220, 50, 50, 255}, {255, 80, 80, 255}) {
        sketch.sketch_remove_constraint(sk, sk.selected_constraint_id)
    }
}
```

The button widget itself follows a standard immediate-mode pattern — hover detection, click state, and visual feedback:

```odin
ui_text_button :: proc(ctx: ^UIContext, x, y, width, height: f32, text: string) -> bool {
    id := ui_gen_id(ctx)
    is_hot := ui_point_in_rect(ctx.mouse_x, ctx.mouse_y, x, y, width, height)
    if is_hot {
        ctx.mouse_over_ui = true
        ctx.hot_id = id
        if ctx.mouse_down && ctx.active_id == 0 {
            ctx.active_id = id
        }
    }
    is_active := ctx.active_id == id
    clicked := is_active && ctx.mouse_clicked && ctx.hot_id == id

    bg_color := ctx.style.bg_medium
    if is_active { bg_color = ctx.style.bg_light
    } else if is_hot { bg_color = ctx.style.bg_medium; bg_color.r += 10 }

    ui_render_rect(ctx, x, y, width, height, bg_color)
    ui_render_text(ctx, text, text_x, text_y, ctx.style.font_size_normal, ctx.style.text_primary)
    return clicked
}
```

All panels are wired together in the main loop via the `AppStateGPU`:

```odin
// ui_render_ui panels assembled each frame
ui_render_ui :: proc(app: ^AppStateGPU) {
    ui_begin_frame(ctx, cmd, pass, mouse_x, mouse_y, mouse_down)

    ui_toolbar_panel(ctx, cad_state, sketch, toolbar_x, toolbar_y, toolbar_width)
    ui_solid_toolbar_panel(ctx, cad_state, solid_x, solid_y, solid_width)
    ui_properties_panel(ctx, cad_state, sketch, feature_tree, prop_x, prop_y, prop_width)
    ui_feature_tree_panel(ctx, cad_state, feature_tree, tree_x, tree_y, tree_width)
    ui_status_bar(ctx, cad_state, 0, screen_height - 30, screen_width)
}
```

Multi-touch gestures (trackpad) support pan, rotate, and zoom in the 3D viewport alongside the UI.

<!-- TODO: insert image -->
{{< image-placeholder "Full application window showing toolbar, feature tree, viewport, and properties panel" >}}

---

## Feature Tree & Undo/Redo

The **feature tree** tracks the parametric dependency graph. When a sketch is modified, downstream features (extrudes, cuts) are marked dirty and regenerated on the next solver run.

A **command history** system supports 50-state undo/redo for all sketch, constraint, and feature operations:

```odin
// core/command/command.odin
Command :: interface {
    execute: proc(self: ^Command, app: rawptr),
    undo:    proc(self: ^Command, app: rawptr),
}

CommandHistory :: struct {
    commands:    [dynamic]^Command,
    current:     int,      // Current position in history
    max_size:    int,      // Maximum history depth (50)
}
```

<!-- TODO: insert image -->
{{< image-placeholder "Feature tree panel showing sketch → extrude → cut dependency chain" >}}

---

## STL Export

Solids can be exported to **STL** for 3D printing. The tessellated triangle mesh is written directly:

```odin
// io/stl/stl_export.odin
export_stl :: proc(solid: ^extrude.SimpleSolid, path: string) -> bool {
    data := fmt.sbprintf("solid ohcad\n")
    for tri in solid.triangles {
        data += fmt.sbprintf("  facet normal %e %e %e\n", tri.normal.x, tri.normal.y, tri.normal.z)
        data += fmt.sbprintf("    outer loop\n")
        data += fmt.sbprintf("      vertex %e %e %e\n", tri.v0.x, tri.v0.y, tri.v0.z)
        data += fmt.sbprintf("      vertex %e %e %e\n", tri.v1.x, tri.v1.y, tri.v1.z)
        data += fmt.sbprintf("      vertex %e %e %e\n", tri.v2.x, tri.v2.y, tri.v2.z)
        data += fmt.sbprintf("    endloop\n")
        data += fmt.sbprintf("  endfacet\n")
    }
    data += fmt.sbprintf("endsolid ohcad\n")
    return os.write_entire_file(path, transmute([]byte)data)
}
```

---

## Key Results

| Metric | Value |
|---|---|
| **Lines of code** | ~12,000 |
| **Build time** | < 3 seconds |
| **Test packages** | 5 (math, geometry, solver, topology, tessellation) |
| **Constraint types** | 12 (horizontal, vertical, distance, coincident, parallel, perpendicular, etc.) |
| **Solver** | Levenberg-Marquardt via SolveSpace libslvs |
| **Boolean kernel** | OpenCascade Technology (OCCT) |
| **Renderer** | SDL3 GPU with Metal backend |

The project is **MIT-licensed** and available at the link below.
