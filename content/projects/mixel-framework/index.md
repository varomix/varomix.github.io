---
title: "Mixel — From HaxeFlixel Port to 2D/3D Game Framework"
coverCaption: "Canabalt running on Mixel, Original Game by Adam Saltsman | https://canabalt.com"
description: "A 2D/3D game development framework written in Odin and inspired by the HaxeFlixel workflow. Built to explore engine architecture, rendering systems, hot-reload tooling, editor development, and cross-platform game creation from the ground up."
tech: ["Odin", "SDL3", "Metal", "Vulkan"]
featured: true
weight: 3
---

## What Started as a Flixel Port

Mixel is a 2D/3D game development framework written in Odin that began as an effort to recreate the rapid prototyping workflow of HaxeFlixel in a systems programming language. What started as a simple port evolved into a complete framework featuring rendering, asset management, hot-reload tooling, an integrated editor, and support for both 2D and 3D game development.

The project explores the challenges of engine architecture, graphics programming, cross-platform rendering, and developer tooling. Over the weeks, it grew into a big codebase with 85+ working examples, physically based rendering, shadow mapping, glTF support, and a custom hot-reload system designed to accelerate iteration during development.

{{< figure src="/images/mixel-framework/phase2_game_demo.png" alt="Sprite animation, camera follow, tilemap collision, and particle effects running in Mixel" caption="2D gameplay showcase — sprite animation, camera follow, tilemap collision, and particle effects" >}}

---

## Why Odin? Why HaxeFlixel?

If you've ever built a game with HaxeFlixel, you know the appeal: it's simple, playful, and stays out of your way. A sprite, a camera, a tilemap, and you're prototyping. I'd been using Odin for other projects and kept wanting that same workflow — but Odin didn't have it.

So I built it. The goal was **authoring parity** — not just porting features, but making common tasks feel just as short and obvious as they do in HaxeFlixel. The same `FlxG` global pattern. The same state lifecycle. The same `overlap`/`collide` semantics. Named `Mix*` instead of `Flx*`, Odin-native from the ground up.

Odin made this easier than C or Rust would have:

- **Compile-time `when` blocks** let me gate the entire 3D layer with `when backend.MIXEL_USE_SDL3` — 2D-only builds pay zero cost for 3D code, with no preprocessor, no build flags, no conditional compilation headaches.
- **`defer` for resource cleanup** eliminated an entire class of memory leaks that plague C game frameworks. GPU allocations, audio buffers, window handles — all released automatically at scope exit.
- **The `vendor` mechanism** ships SDL3 with the compiler. No package manager, no `apt install`, no CMake FetchContent. `import "vendor:sdl3"` and you're done.
- **No build system.** `odin build .` compiles the entire project. Ninety-eight example files, zero build configuration.

That part worked. What I didn't expect was where it would go next.

---

## Architecture Overview

Mixel is organized in three layers:

```
Game Code         (your game — imports mixel, never imports backends)
    |
Mixel Core        (mixel/*.odin — 60 files, ~38k LOC)
    |
Backend Runtime   (backends/runtime/backend.odin — compile-time dispatch)
    |
SDL3 GPU            Raylib
(Metal/Vulkan)      (2D fallback)
```

The core is built around `MixBasic` — a base type with update/draw/destroy function pointers, embedded in every game object. `MixGame` runs a fixed-timestep loop (configurable update/draw Hz independently). States stack hierarchically with camera-filtered rendering per layer.

The cradle/dylib hot-reload system adds a fourth layer:

```
mixel_cradle (thin host — owns GPU context, audio, window)
    |  Mix_API_V1 function table
Game dylib   (compiled separately, reloaded at runtime)
```

{{< mermaid >}}
graph TD
    subgraph "Runtime"
        Cradle[mixel_cradle] -->|Mix_API_V1| Game[Game dylib]
        Cradle --> GPU[SDL3 GPU Context]
        Cradle --> Audio[SDL3 Audio Mixer]
        Cradle --> Window[OS Window]
    end
    subgraph "Compile Time"
        Game --> Mixel[Mixel Core]
        Mixel --> Runtime[backend/runtime]
        Runtime -->|when MIXEL_USE_SDL3| SDL3[SDL3 GPU Backend]
        Runtime -->|else| Raylib[Raylib Backend]
    end
{{< /mermaid >}}

If that sounds over-engineered for a hobby framework — it is. And it took three rewrites to get right.

---

## The 2D Core

The 2D side is what you'd want from a HaxeFlixel-alike: fixed-timestep loop, state stacking, sprites with animation, cameras with follow/shake/fade/flash, tilemaps with auto-tiling and per-tile collision, tweens, timers, particles, sound, text, save data, and an in-game debugger.

Here's Breakout in the style of it:

```odin
config := mx.MixGame_Config{
    title = "Breakout",
    width = 640, height = 360,
    initial_state = game_state,
}
mx.mix_game_init(&game, config)
mx.mix_game_start(&game)
```

One `state` with an `on_create` that builds the paddle, ball, and bricks. An `on_update` that checks collision with `mx.MixG.collide()`. Done.

{{< figure src="/images/mixel-framework/sprite_animation.png" alt="Sprite animation demo running in Mixel" caption="Sprite animation with frame slicing and playback controls" >}}
{{< figure src="/images/mixel-framework/tilemap_collision.png" alt="Tilemap with collision visualization" caption="Tilemap with auto-tiling and per-tile collision data" >}}

Where it gets interesting is what came after.

---

## Where It Gets Interesting

At some point I stopped asking "how close can I get to HaxeFlixel?" and started asking "what else can this do?" The answer turned out to be: a lot.

Mixel now ships with a full **SDL3 GPU-accelerated 3D layer**. It renders before the 2D HUD pass, so every existing Mixel 2D overlay — health bars, debug stats, fade transitions — works unmodified in a 3D scene.

```odin
// A 3D scene in ~15 lines — with a 2D HUD that works automatically
world := mx.mix_world3d_new()
world.camera = mx.MixCamera3D{
    position = mx.vec3(0, 1.2, 5),
    target   = mx.vec3(0, 0, 0),
    fov_y    = 60, near = 0.1, far = 100,
}
mesh := mx.mix_mesh3d_cube_new(1)
cube := mx.mix_object3d_new(mesh)
cube.material = mx.mix_material3d_lambert()
cube.color = mx.rgba(200, 100, 100)
mx.mix_world3d_add(world, cube)

// The 2D HUD still renders on top — same loop, no extra work
text := mx.mix_text_create(state)
text.text = "FPS: %d", mx.MixG.debugger.fps
```

### PBR, Shadows, and Lighting

The 3D renderer supports Unlit, Lambert, **PBR** (metallic/roughness with normal, occlusion, and emissive maps), and **Toon** (cel-shaded) lighting models. Directional lights cast cascaded shadow maps with PCF filtering — the rotation-invariant bounding sphere technique that eliminates shimmer. Point and spot lights work too.

HDR environment maps load from equirectangular radiance files. The framework generates diffuse irradiance cubemaps, roughness-prefilter specular atlases, and the BRDF LUT — all on the CPU, all in Odin. ACES tone mapping on the output.

{{< figure src="/images/mixel-framework/PBR_Helmet.webp" alt="PBR helmet model showing metallic reflections, rough surfaces, and HDR environment lighting" caption="Physically-based rendering in Mixel — the DamagedHelmet model showing metallic reflections, roughness variation, normal map detail, and HDR environment map lighting with ACES tone mapping" >}}

### glTF, Skinned Animation, and Instancing

```odin
// Load a skinned zombie from glTF
zombie := mx.mix_gltf3d_load("assets/zombie.glb")
mx.mix_gltf3d_apply_animation(&zombie, 0, time)
mx.mix_world3d_add(world, zombie.mesh)

// 10,000 instanced cubes — one draw call
group := mx.mix_instanced_mesh3d_new(cube_mesh)
for i in 0..10000 {
    mx.mix_instanced_mesh3d_add_instance(group, {
        transform = {position = random_vec3()},
        color = random_color(),
    })
}
mx.mix_world3d_add_instanced(world, group)
```

Static models load from glTF/GLB (with embedded textures and data URIs) or OBJ/MTL. Skinned animation supports up to 64 bones with cross-fade blending. Instancing pushes 10,000+ objects in a single draw call.

{{< figure src="/images/mixel-framework/zombie_gltf.png" alt="Skinned zombie glTF model with walk animation" caption="glTF skinned animation — walk cycle on a zombie model with 64 bones" >}}

### Post-Processing

Eight built-in post-process effects: invert, tint, vignette, grayscale, Sobel outlines, halftone, dither, and hatching. Fog (linear, exponential, exponential-squared). All toggled per-frame on the world struct — zero pipeline rebuild.

{{< figure src="/images/mixel-framework/post_processing.png" alt="Post-processing effects cycling through invert, grayscale, Sobel outlines, halftone, dither, and hatching on a 3D scene" >}}

---

## The Cradle That Didn't Crash

The hot-reload system is the piece I'm most proud of — and the one that took the most beating to get right.

Mixel uses a **cradle/dylib** pattern: a thin cradle executable owns the GPU context, audio mixer, and window. Game code compiles as a dynamic library. The cradle hands it a function-pointer table (`Mix_API_V1`) at startup — no linker dependencies, no duplicated globals.

```odin
Mix_API_V1 :: struct {
    game_init:   proc(game: ^MixGame, config: MixGame_Config),
    game_start:  proc(game: ^MixGame),
    game_update: proc(game: ^MixGame, dt: f32),
    game_draw:   proc(game: ^MixGame),
}
```

It took three rewrites:

- **V1** leaked GPU resources on every reload. Textures, pipelines, and buffer allocations accumulated in GPU memory until the driver killed the process. The fix required a complete GPU allocation tracker that walks every resource and releases it before swapping the dylib.

- **V2** tracked allocations but couldn't handle shader recompilation. If your game code changed a vertex shader, the old pipeline objects persisted in GPU memory and the new ones failed to compile against stale state. The fix was rebuilding all pipelines from the new code after every reload, not just the ones that changed.

- **V3** — the current one — tracks every GPU allocation with generation counters, releases everything before swapping the dylib, then rebuilds all pipelines from the new code. Edit → recompile → see results. No restart, no leak, no stale state.

---

## The Editor

The editor is built on Dear ImGui with dockable panels: a 3D viewport (off-screen render target embedded in ImGui), a scene hierarchy, an inspector for transforms/materials/lights, and an asset browser with texture and mesh thumbnails.

{{< figure src="/images/mixel-framework/editor_panels.png" alt="ImGui editor with 3D viewport, scene hierarchy, inspector, and asset browser in a docked layout" caption="The Mixel editor — dockable ImGui panels with 3D viewport, scene hierarchy, inspector, and asset browser" >}}

The editor reuses the same cradle architecture — it's just a dylib that happens to draw ImGui panels. Asset hot-reload (textures, OBJ meshes) and shader hot-reload work through the same system.

---

## Proof: 85+ Examples That Actually Work

Numbers are cheap. Working examples aren't. Every example in the repository proves a specific capability:

| Category | Count | What It Proves |
|---|---|---|
| **Phase demos** | 10 | Progressive tour of every core system — boot, camera, sprite, input, collision, tilemap, HUD, audio, effects, animation |
| **Feature ports** | 22 | Collision, tilemap, Box2D, FSM, pathfinding, replay, save, split-screen, scene system, particles, pie dials, scale modes |
| **Effect demos** | 18 | Bloom, blur, glitch, cloth sprite, dynamic shadows, flood fill, transitions, tweens, custom shaders, parallax, trail areas |
| **Arcade ports** | 10 | Breakout, Canabalt, Flappybalt, Flixius, MinimalistTD, MixInvaders, MixLightPuzzle, MixPongApi, MixSnake, MixTeroids |
| **3D examples** | 25+ | Cubes, lights, textures, PBR, shadows, glTF, instancing, FPS, physics, toon shading, billboards, morph targets, split-screen, editor sandwich |

Each one runs with a single command:

```bash
odin run examples/arcade/Breakout -collection:mixel=.
odin run examples/3d/Mix3DPBR -collection:mixel=.
```

{{< figure src="/images/mixel-framework/examples_grid.png" alt="Grid of example screenshots — arcade ports, effect demos, and 3D scenes" caption="A sampling of working examples — arcade ports, effect demos, and 3D scenes" >}}

The hardest ports taught me the most. Breakout took two hours (everything fit the API). Invaders took three days (the sprite-atlas animation system had edge cases I hadn't hit in my own demos). The PBR viewport demo forced me to fix five separate bugs in the descriptor management layer.

---

## The Numbers

| | |
|---|---|
| **Framework LOC** | ~38,778 Odin across 60 source files |
| **Backends** | SDL3 GPU (Metal/Vulkan), Raylib 2D fallback |
| **Examples** | 85+ across phases, features, effects, arcade, 3D |
| **3D lighting** | Unlit, Lambert, PBR, Toon |
| **3D shadows** | Directional shadow maps with PCF |
| **Post-effects** | 8 built-in, toggle per frame |
| **Asset formats** | glTF/GLB, OBJ/MTL |
| **Skinned animation** | glTF, up to 64 bones, CPU skinning |
| **Platforms** | macOS, Linux, Windows |
| **Timeline** | ~5 weeks, 87 commits (Apr 29 — Jun 3, 2026) |
| **Build** | `odin run . -collection:mixel=.` |

---

## What I Learned

**1. GPU resource tracking is the hardest part of a game framework.** Textures, pipelines, buffers, samplers — every GPU API resource has a different creation path, a different destruction path, and a different lifetime. Getting hot-reload right meant building a resource tracker before most of the renderer. If I started over, I'd build the tracker first.

**2. Backend abstraction is a liar's bargain.** The compile-time `when` dispatch between SDL3 GPU and Raylib works, but every new feature adds a conditional branch. The 3D layer is SDL3-only because the abstraction cost wasn't worth it. Two backends is already one too many for a solo project.

**3. Fixed-timestep with variable draw is the right call for 2D, wrong for 3D.** The decoupled update/draw Hz works beautifully for pixel-art games where you want deterministic physics at 60 updates per second but don't need 60 FPS draws. For 3D, you want variable update with interpolation — the current architecture wastes GPU time on 3D frames nobody sees.

**4. ImGui is a surprisingly good editor foundation.** It's not pretty, but it works on every platform, docks out of the box, and the off-screen render target pattern is a known solution. The asset browser thumbnail pipeline was the hardest part — not ImGui itself.

**5. Odin's build model is a superpower for framework distribution.** No CMake, no vcpkg, no Conan, no package manager. The compiler is a single binary. `odin run .` compiles and runs. That's it. For a framework that wants people to try it, this removes more friction than any API design decision.

---

## What I'd Do Differently

- **Build the GPU resource tracker before anything else.** It would have saved the V1 and V2 rewrites of the cradle.
- **Skip the Raylib backend.** It was useful for early prototyping but has been a maintenance tax since the SDL3 backend matured. Pareto says drop it.
- **Write more examples earlier.** The phase demos were written after the features. Writing them concurrently would have caught API design mistakes faster.
- **Add a scripting layer.** Mixel is pure Odin, which means every change requires a recompile (even with hot-reload). A Lua or WASM script layer for game logic would make iteration faster for game jams.

---

## What's Next

The 2D core is stable. The 3D layer is actively expanding — deferred shading, GPU skinning, and more post-effects are in progress. The editor's asset browser needs thumbnails for glTF files. GPU skinning is roughly two weeks out. Deferred shading will follow.

Long-term, I'd like to see someone ship a full game with this.

---

## Try It

```bash
cd hflixel_odin
odin run examples/arcade/Breakout -collection:mixel=.
```

Or pick any of the 85+ examples. The Odin compiler is a single binary download — no package manager, no dependency hell. One command, and you're running a Mixel game.

Star the repo, fork it, or just run Breakout and see what 38,000 lines of Odin can do. I'd love to see what you build.

---

*If you've ever wanted the HaxeFlixel workflow in a systems language — or you just want to see what happens when a 2D framework grows a 3D renderer — this is it.*
