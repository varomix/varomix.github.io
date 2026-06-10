---
title: "Mixel — From HaxeFlixel Port to 2D/3D Game Framework"
description: "A 2D/3D game framework written in Odin that started as a HaxeFlixel port and grew into a full engine with PBR rendering, hot-reload tooling, glTF support, and an ImGui editor."
tech: ["Odin", "SDL3", "Metal", "Vulkan"]
coverCaption: "Canabalt running in Mixel, original game by Adam Saltsman https://canabalt.com/"
featured: true
weight: 1
---

## What Is It?

Mixel is a 2D/3D game framework for Odin that started as a desire to write Flixel-style games in a systems language and ended up as something much larger. Think HaxeFlixel's rapid prototyping workflow — sprites, cameras, tilemaps, collisions — combined with a full SDL3 GPU-accelerated 3D layer, physically based rendering, skinned glTF animation, hot-reload that doesn't crash, and an ImGui editor.

What makes Mixel distinctive is how it grew. It didn't start with a grand design document. It started with Breakout. Then a sprite animation demo. Then the question "what if this also did 3D?" Then PBR, shadow maps, glTF loading, instancing, post-processing, and an editor. At 38,000 lines of Odin across 60 source files, it's too big to be a hobby project and too idiosyncratic to be a product. But it works — 85+ examples ship with it, every one runnable with `odin run . -collection:mixel=.`.

## Why Did I Build It?

I'd been using HaxeFlixel for years and loved the workflow — a sprite, a camera, a tilemap, and you're prototyping in minutes. But I wanted that workflow in a language that compiles to native code, runs on the GPU, and doesn't carry a VM. Odin was the perfect fit: fast compiles, explicit memory management, and a `vendor` mechanism that ships SDL3 with the compiler. Mixel started as a straight port of the Flixel API, and for the first week that's all it was. Then I kept wondering "what else can this do?" — and the scope expanded until the port was the smallest part of the project.

## What Did I Learn?

**The hot-reload cradle took three full rewrites, and the first two leaked GPU memory in creative ways.** V1 worked for code changes but never released old GPU resources — textures, pipelines, and buffers accumulated until the Metal driver killed the process. V2 tracked every allocation but couldn't handle shader recompilation: if a vertex shader changed, the old pipeline objects persisted in GPU memory and the new ones failed to compile against stale state. V3 finally works by tracking every GPU allocation with generation counters, releasing everything before swapping the dynamic library, and rebuilding all pipelines from the new code after every reload. The pattern is conceptually simple — save → recompile → see results — but getting there cost more time than any other single system in the framework.

**Two backends are demonstrably one too many for a solo project.** Mixel has a compile-time `when` dispatch between SDL3 GPU (Metal/Vulkan) and Raylib. The dispatch itself is elegant — `when backend.MIXEL_USE_SDL3` gates entire code paths with zero runtime cost. But every new feature adds a conditional: a PBR shader works on SDL3 GPU but not Raylib, instancing needs a different API path, shadow maps are SDL3-only. The 3D layer is exclusive to SDL3 GPU because the abstraction cost was too high. If I were starting over, I'd pick one backend and commit to it.

**Fixed-timestep update with variable draw is perfect for 2D pixel art and wrong for 3D.** The decoupled update/draw Hz works beautifully for 2D games where you want deterministic physics at 60 updates per second but don't need 60 FPS rendering — the game logic stays consistent even when the frame rate drops. For 3D, variable update with interpolation gives smoother camera motion and better GPU utilization. The current architecture wastes GPU time rendering 3D frames that nobody will see because the next update hasn't run yet.

**Odin's `when` blocks are the best conditional compilation I've ever used.** The entire 3D layer is gated behind `when backend.MIXEL_USE_SDL3`. No preprocessor, no separate build configurations, no CMake options — just a compile-time boolean that eliminates dead code. A 2D-only game compiled with the Raylib backend pays zero code size or compile time for the 3D layer. This single language feature made the dual-backend strategy feasible even though I'd advise against dual backends in general.

**ImGui is ugly but it solved the editor problem in a weekend instead of a month.** The editor uses Dear ImGui with dockable panels, an off-screen 3D viewport rendered to an ImGui texture, and the same cradle architecture as the game runtime. It's not beautiful, but it works on every platform, docks out of the box, and the off-screen render target pattern is a known solution. The hardest part was the asset browser thumbnail pipeline, not ImGui itself.

## Key Results

| Metric | Value |
|---|---|
| **Hot-reload** | Cradle/dylib pattern with full GPU resource tracking, no leaks across reloads |
| **3D renderer** | PBR (metallic/roughness), Toon, Lambert, Unlit — with ACES tone mapping |
| **Shadow mapping** | Directional cascaded shadow maps with PCF filtering, rotation-invariant bounding spheres |
| **glTF support** | Static and skinned models (up to 64 bones), embedded textures, cross-fade animation blending |
| **Instancing** | 10,000+ objects in a single draw call |
| **Post-processing** | 8 effects (invert, tint, vignette, grayscale, Sobel, halftone, dither, hatching) + fog |
| **HDR environment** | Equirectangular → diffuse irradiance cubemap + specular prefilter + BRDF LUT, all CPU-generated |
| **Editor** | ImGui with 3D viewport, scene hierarchy, inspector, asset browser — shares cradle architecture |
| **Examples** | 85+ across phases, effects, arcade ports, and 3D demos — all runnable with one command |
| **Framework LOC** | ~38,778 Odin across 60 source files |
| **Backends** | SDL3 GPU (Metal/Vulkan) + Raylib 2D fallback (compile-time dispatch) |
| **Build** | `odin run . -collection:mixel=.` — no build system, no package manager |

## Screenshots / Video

{{< video-placeholder src="/images/mixel-framework/mixel_pbr_loop_web.mp4" alt="PBR helmet with environment reflections in Mixel 3D" >}}

{{< figure src="/images/mixel-framework/mixel_2d_grid.webp" alt="2D gameplay showcase — MixTeroids, MixInvaders, Box2D terrain, and PathFinding Examples" caption="2D gameplay showcase — MixTeroids, MixInvaders, Box2D terrain, and PathFinding Examples" >}}

{{< figure src="/images/mixel-framework/mixel_3d_grid.webp" alt="3D features showcase — Primitives, FPS with GPU Skinning, Marble Roller, and 3D Breakout Exampless" caption="3D features showcase — Primitives, FPS with GPU Skinning, Marble Roller, and 3D Breakout Exampless" >}}



## Technical Deep Dive

For the engineers wondering how a game framework grows from a Flixel port to a PBR renderer — here is the architecture, the hot-reload mechanism, and the rendering pipeline that ties it together.

### Three-Layer Architecture

```
Game Code         (your game — imports mixel, calls MixG.init/draw/update)
    │
Mixel Core        (mixel/*.odin — 60 files, ~38k LOC)
    │
Backend Runtime   (backends/runtime/backend.odin — compile-time when dispatch)
    │
SDL3 GPU            Raylib
(Metal/Vulkan)      (2D fallback)
```

The core is built around `MixBasic` — a base type with function pointers for update, draw, and destroy, embedded in every game object. `MixGame` runs a fixed-timestep loop with independently configurable update/draw Hz. States stack hierarchically, and the camera system filters rendering per layer.

### The Cradle Hot-Reload Pattern

Hot-reload adds a fourth layer outside the game loop:

```
mixel_cradle (thin host — owns GPU context, audio, window)
    │  Mix_API_V1 function table
Game dylib   (compiled separately, swapped at runtime)
```

The cradle is a minimal executable (under 500 lines) that creates the SDL3 window, initializes the GPU context, and loads the game as a dynamic library. Communication happens through a fixed function-pointer table:

```odin
Mix_API_V1 :: struct {
    game_init:   proc(game: ^MixGame, config: MixGame_Config),
    game_start:  proc(game: ^MixGame),
    game_update: proc(game: ^MixGame, dt: f32),
    game_draw:   proc(game: ^MixGame),
}
```

On reload, the cradle:
1. Stops the game loop
2. Releases every GPU resource tracked by generation counter (textures, pipelines, buffers, samplers)
3. Unloads the current dylib
4. Loads the new dylib
5. Rebuilds all GPU pipelines from the new shader sources
6. Reinitializes game state and resumes the loop

The GPU resource tracker is a flat array with generation counters:

```odin
GPUResourceTracker :: struct {
    resources: [MAX_GPU_RESOURCES]GPUResource,
    generation: u64,
}

track_allocate :: proc(tracker: ^GPUResourceTracker, resource: GPUResource) {
    resource.generation = tracker.generation
    tracker.resources[tracker.count] = resource
    tracker.count += 1
}

release_all :: proc(tracker: ^GPUResourceTracker) {
    for i in 0..tracker.count {
        release_resource(tracker.resources[i])
    }
    tracker.count = 0
    tracker.generation += 1
}
```

### The 2D/3D Render Pass Stack

Every frame potentially executes two GPU render passes. The 3D pass runs first (clearing both color and depth), then the 2D overlay pass loads the existing color buffer with alpha blending:

```odin
// In the draw loop — automatic based on content
if renderer3d_has_data {
    // Pass 1: 3D with depth
    begin_gpu_render_pass(cmd, &color_target, &depth_target, CLEAR)
    renderer3d_draw_all(world)
    end_gpu_render_pass(cmd)

    // Pass 2: 2D overlay — LOAD color, no depth
    begin_gpu_render_pass(cmd, &color_target, nil, LOAD)
    renderer2d_draw_all(world)  // sprites, HUD, text
    end_gpu_render_pass(cmd)
} else {
    // 2D only: single pass
    begin_gpu_render_pass(cmd, &color_target, nil, CLEAR)
    renderer2d_draw_all(world)
    end_gpu_render_pass(cmd)
}
```

The depth buffer is lazily allocated on first 3D use — a 2D-only game never pays the memory cost.

### PBR Pipeline and Environment Maps

The PBR renderer supports metallic/roughness workflow with Cook-Torrance BRDF. Environment maps are loaded from equirectangular HDR files and processed on the CPU into three cubemaps:

1. **Diffuse irradiance** — convolution of the environment map by cosine-weighted hemisphere sampling
2. **Specular prefilter** — mipmapped roughness levels, pre-convolved with the GGX distribution
3. **BRDF LUT** — 2D lookup table for the Fresnel/geometry integral

All three are computed in Odin at load time using compute shader-like CPU passes. The generation takes about 2 seconds per environment map on M-series hardware — slow enough to notice, fast enough to keep.

### The Feature That Took Longest: glTF Skinned Animation

Skinned animation from glTF was the hardest single feature. The challenges:

- **Bone hierarchy flattening.** glTF stores bones as a tree with local transforms. The GPU wants a flat array of global inverse-bind-pose matrices. The flatten pass recurses the skeleton, concatenates transforms, and outputs 64 `mat4` entries.
- **CPU skinning vs GPU skinning.** Mixel does CPU skinning — it transforms each vertex by the weighted bone matrices on the CPU before uploading to the GPU. This is simpler to debug (you can print the skinned vertex positions) but caps the vertex count at about 50,000 skinned vertices per frame at 60 FPS. GPU skinning is on the roadmap.
- **Cross-fade blending.** Two animation clips (e.g., walk → run) blend by interpolating each bone's local transform before the flatten pass. The blend weight is controlled by the game code, and the transition is smooth as long as both animations have the same bone set.

glTF loading itself goes through a custom parser that handles the binary GLB format (fast, single file) and the text glTF format (debuggable, references external buffers). Mesh data (positions, normals, texcoords, joints, weights) is uploaded to GPU vertex buffers; animation data (keyframe translation/rotation/scale per bone) stays on the CPU and is sampled each frame.
