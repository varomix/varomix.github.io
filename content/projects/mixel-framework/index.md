---
title: "Mixel — A 2D/3D Game Framework in Odin"
description: "An Odin game framework with MixState/MixSprite/MixCamera/MixTween/MixTilemap workflow, SDL3 GPU-accelerated 3D rendering, ImGui editor, hot-reload cradle architecture, and 25+ 3D examples — inspired by HaxeFlixel and built for desktop game development."
tech: ["Odin", "SDL3", "Metal", "Vulkan"]
weight: 1
---

## Overview

Mixel is a **2D/3D game framework for Odin** that reproduces the workflow and gameplay behavior of HaxeFlixel while adding a full SDL3 GPU-powered 3D layer, an ImGui-based editor, and a hot-reload architecture. It exposes the familiar state/sprite/camera/tilemap/tween/sound model through Odin-native `Mix*` APIs.

The project is structured in two tracks: a mature **2D core** with feature parity close to HaxeFlixel's workflow, and an expanding **3D layer** that runs on SDL3's GPU backend with Metal (macOS) / Vulkan (Linux, Windows). The editor is under active development, built on ImGui with dockable panels, a 3D viewport, scene hierarchy, inspector, and asset browser.

{{< video-placeholder "Mixel 2D game demo — sprite animation, camera follow, and collision" >}}

---

## Design Philosophy

Mixel's goal is **authoring parity** with HaxeFlixel — keeping the simple, playful API style while exposing it through Odin. Key principles:

- **`Mix*` naming**: Every public type and function uses the `Mix` prefix — `MixSprite`, `MixCamera`, `MixTween`, `MixState`, `MixG`
- **Global runtime via `MixG`**: `MixG.keys`, `MixG.camera`, `MixG.sound`, `MixG.inputs`, `MixG.effects`, `MixG.signals` — matches the HaxeFlixel `FlxG` pattern
- **Backend-agnostic**: All rendering, input, and audio goes through a runtime backend layer. SDL3 is the default; raylib remains as a 2D fallback
- **Desktop-first**: macOS, Linux, Windows — no HTML5 or mobile targets in scope
- **2D/3D coexistence**: 3D renders before the 2D HUD/debugger pass, so existing 2D overlays work with any 3D scene

---

## Project Layout

```
mixel/                     # Public framework code
├── game.odin              # MixGame — fixed-timestep loop, state management
├── globals.odin           # MixG — global runtime access
├── state.odin             # MixState, MixSubState, ordered state layers
├── basic.odin             # MixBasic — base lifecycle (active/visible/alive)
├── object.odin            # MixObject — position, velocity, acceleration, drag
├── sprite.odin            # MixSprite — textures, animation, color, flip, skew
├── group.odin             # MixGroup — typed member management
├── camera.odin            # MixCamera — follow, zoom, shake, fade, flash
├── draw.odin              # Blend modes, filter modes
├── scene.odin             # Scene graph and rendering traversal
├── input.odin             # Keyboard, mouse, gamepad
├── tilemap.odin           # MixTilemap — tile loading, rendering, collision
├── tween.odin             # MixTween — easing, looping, chaining
├── timer.odin             # MixTimer — one-shot and repeating timers
├── sound.odin             # MixSound, MixMusic — loading, playback, fading
├── text.odin              # MixText — font rendering
├── bitmap_text.odin       # MixBitmapText — bitmap glyph text
├── effects.odin           # Camera shake, flicker
├── shader.odin            # Custom sprite shader loading
├── emitter.odin           # Particle emitter
├── transition.odin        # Screen transitions
├── save.odin              # Save data management
├── signals.odin           # Event signal system
├── quadtree.odin          # Spatial partitioning
├── bar.odin               # MixBar — health bars, progress bars
├── button.odin            # MixButton — UI buttons
├── three_d.odin           # Full 3D layer (6,400+ lines)
├── editor/                # ImGui-based editor
│   ├── editor.odin        # Stats overlay, editor API
│   ├── viewport.odin      # 3D viewport panel with dock layout
│   ├── theme.odin         # ImGui dark theme
│   └── backend.odin       # Editor backend interface
└── hot_reload_api.odin    # Function-pointer table for dylib reloading

backends/
├── sdl3/                  # Default backend (SDL3 GPU, Metal/Vulkan)
├── raylib/                # 2D fallback backend
└── runtime/               # Backend abstraction layer

examples/
├── phase1-10/             # Progressive engine examples (core systems)
├── features/              # Feature-specific demos
├── effects/               # Visual effects and shaders
├── arcade/                # HaxeFlixel Arcade demo ports
├── box2d_smoke/           # Box2D physics
└── 3d/                    # 25+ 3D examples
    ├── Mix3DCube          # Rotating cubes with HUD
    ├── Mix3DLights        # Directional + point lights
    ├── Mix3DTextured      # Textured materials
    ├── Mix3DGLTF          # glTF/GLB model loading
    ├── Mix3DPBR           # PBR with HDR environment
    ├── Mix3DShadows       # Directional shadow maps
    ├── Mix3DFPS           # First-person with skinned glTF
    ├── Mix3DInstancing    # Many-object stress test
    ├── Mix3DEditorSandwich # Editor + game render pass
    ├── Mix3DPhysics       # Collider/BVH queries
    └── ... (25 total)
```

---

## 2D Core

### MixGame & MixG

Mixel uses a fixed-timestep update loop controlled by `update_hz` with independent `draw_hz`. State switching, substate stacking, and lifecycle dispatch follow HaxeFlixel conventions:

```odin
config := mx.MixGame_Config{
    title = "My Game",
    width = 640, height = 360,
    update_hz = 60, draw_hz = 60,
    initial_state = game_state,
    debugger_enabled = true,
}
mx.mix_game_init(&game, config)
mx.mix_game_start(&game)
```

All global subsystems are accessed through `MixG`:

```odin
mx.MixG.keys.is_key_down(mx.MixKey_Space)
mx.MixG.camera.shake(0.01, 0.5)
mx.MixG.sound.play(sfx)
```

### MixState

States have named lifecycle hooks — `on_create`, `on_update`, `on_draw`, `on_destroy` — and four built-in render layers: `background_group`, `group`, `fx_group`, `hud_group`. Sub-states stack on top with optional persistence:

```odin
state := mx.MixState{
    on_create = proc(s: ^mx.MixState) {
        sprite := mx.mix_sprite_create(s)
        mx.mix_sprite_load_graphic(sprite, "assets/player.png")
        mx.mix_state_add(s, sprite)
    },
    on_update = proc(s: ^mx.MixState, dt: f32) {
        if mx.MixG.keys.is_key_pressed(mx.MixKey_Space) {
            mx.mix_open_sub_state(s, pause_state)
        }
    },
}
```

### MixSprite

Sprites support texture rendering, animation, color tint, alpha, scale, flip, skew, blend modes, and custom shaders:

```odin
sprite := mx.mix_sprite_create(state)
mx.mix_sprite_load_graphic(sprite, "assets/player.png")
mx.mix_sprite_set_graphic_size(sprite, 16, 16)
mx.mix_sprite_animation_add(sprite, "run", {0, 1, 2, 3}, 12, true)
mx.mix_sprite_animation_play(sprite, "run")
sprite.color = mx.Red
sprite.scale = mx.mix_point(2, 2)
```

{{< image-placeholder "Sprite animation demo with multiple characters and effects" >}}

### MixCamera

Cameras support follow targets with multiple styles (lock-on, platformer, top-down, screen-by-screen), dead zones, lead, lerp, shake, fade, and flash effects:

```odin
camera := mx.mix_camera_create(state)
camera.follow_target = &player.object
camera.follow_style = .Platformer
camera.follow_lerp = 0.1
mx.mix_camera_shake(camera, 0.01, 0.5)
mx.mix_camera_fade(camera, mx.Black, 0.5)
```

{{< image-placeholder "Camera follow and shake effects in a platformer scene" >}}

### Input, Sound, Tweens, Timers

```odin
// Keyboard/mouse/gamepad through MixG
mx.MixG.keys.is_key_down(mx.MixKey_Space)
mx.MixG.keys.is_key_just_pressed(mx.MixKey_Enter)
mx.MixG.mouse.screen_x, mx.MixG.mouse.screen_y

// Sound
sfx := mx.mix_sound_load("assets/jump.wav")
mx.MixG.sound.play(sfx, mx.mix_sound_options(volume=0.5))

// Tween
mx.mix_tween_f32(&player.x, 0, 500, 2.0, .QuadOut, {loop_type=.PingPong})

// Timer
mx.mix_timer(1.5, true, proc(t: ^mx.MixTimer) { ... })
```

### Collision & Tilemaps

```odin
// Sprite groups and collision
mx.MixG.collide(player_group, wall_group)
mx.MixG.overlap(bullets, enemies, on_hit)

// Tilemap
tilemap := mx.mix_tilemap_create(state)
mx.mix_tilemap_load_map_from_csv(tilemap, "assets/map.csv", "assets/tileset.png")
mx.mix_tilemap_set_collision_by_index(tilemap, {1, 2, 3}, true)
mx.MixG.collide(player, tilemap)
```

{{< image-placeholder "Tilemap level with collision visualization overlay" >}}

---

## 3D Layer

The 3D layer is SDL3 GPU-only and runs as an opt-in system alongside the existing 2D pipeline. It renders before the 2D HUD/debugger pass, so standard Mixel 2D overlays work with any 3D scene.

### Core Types

```odin
world := mx.mix_world3d_new()
defer mx.mix_world3d_free(world)

// Camera
world.camera = mx.MixCamera3D{
    position = mx.vec3(0, 1.2, 5),
    target  = mx.vec3(0, 0, 0),
    fov_y   = 60,
    near    = 0.1, far = 100,
}

// Mesh
mesh := mx.mix_mesh3d_cube_new(1)

// Object
cube := mx.mix_object3d_new(mesh)
cube.transform.position = mx.vec3(0, 0, 0)
cube.material = mx.mix_material3d_lambert()
cube.color = mx.rgba(200, 100, 100)
mx.mix_world3d_add(world, cube)
```

{{< image-placeholder "3D viewport showing multiple objects with different materials" >}}

### Materials & Lighting

```odin
// Material types
mat_unlit   := mx.mix_material3d_unlit()
mat_lambert := mx.mix_material3d_lambert()
mat_pbr     := mx.mix_material3d_pbr(.5, .3)  // metallic, roughness

// Textured material
mx.mix_material3d_set_texture(&mat, texture)
mx.mix_material3d_set_normal_texture(&mat, normal_map)

// Lights
world.directional_light = {direction=vec3(0.5, -1, 0.3), color=White, strength=1}
world.ambient_strength = 0.3
world.point_lights[0] = {position=vec3(2, 1, 0), color=Red, strength=3, radius=5}
```

{{< image-placeholder "PBR spheres under multiple lights with environment reflections" >}}

### Shadows & Post-Processing

```odin
// Directional shadow maps
mx.mix_world3d_set_directional_shadows(&world, true, 1024)

// Post-processing (invert, tint, vignette, grayscale, sobel, halftone, dither, hatching)
world.post_effect = {kind=.Vignette, intensity=0.5, radius=0.3, falloff=0.5}
```

{{< video-placeholder "Post-processing effects cycling through invert, grayscale, sobel, halftone, dither, and hatching" >}}

### glTF & Skinned Animation

```odin
// Static glTF
asset := mx.mix_asset_load_model3d_obj("assets/barrel.obj")
mx.mix_object3d_set_mesh(obj, asset.mesh)

// Skinned glTF with animation
zombie := mx.mix_gltf3d_load("assets/zombie.glb")
mx.mix_gltf3d_apply_animation(&zombie, 0, time)

// FPS-style first-person camera with separate meshes
world.camera.position = mx.vec3(0, 1.7, 0)
mx.mix_world3d_add(world, pistol_mesh)
```

{{< video-placeholder "Skinned zombie glTF model playing walk animation in first-person view" >}}

### Instancing

```odin
group := mx.mix_instanced_mesh3d_new(mesh)
for i in 0..1000 {
    mx.mix_instanced_mesh3d_add_instance(group, {
        transform = {position = vec3(x, y, z)},
        color = random_color(),
    })
}
mx.mix_world3d_add_instanced(world, group)
```

{{< image-placeholder "10,000 instanced cubes stress test with colored materials" >}}

### Current 3D Status

The 3D layer is actively developed with the following shipped:

- Perspective/orthographic cameras with sub-rect viewports (split-screen, minimap)
- Unlit, Lambert, PBR, and Toon (cel-shaded) lighting
- Directional, point, and spot lights
- Directional shadow maps with PCF filtering
- Textured materials with normal, metallic/roughness, occlusion, and emissive maps
- HDR environment lighting with equirectangular radiance maps
- CPU-generated diffuse irradiance + roughness-prefilter textures
- ACES tone mapping
- glTF/GLB loading with embedded textures and data URIs
- Morph targets
- Custom post-processing (8 effects: invert, tint, vignette, grayscale, sobel, halftone, dither, hatching)
- Fog (linear, exponential, exponential-squared)
- Transparency sorting (alpha depth-write and alpha depth-read pipelines)
- Frustum culling, material sorting, and batching
- GPU instancing (separate vertex pipeline, instance buffer)
- Persistent GPU mesh resources for eligible objects
- OBJ loader with MTL material support
- Colliders (AABB, sphere) with intersection queries and world raycasting
- Skinned glTF animation with CPU skinning
- First-person camera with weapon mesh
- MixBillboard3D (full-facing and axis-Y cylindrical)

---

## Editor

The editor is under active development, built on ImGui with a dockable panel layout:

- **Viewport**: Off-screen 3D render target embedded in an ImGui panel, drag-drop mesh asset support
- **Scene**: Hierarchy panel with object selection
- **Inspector**: Object transform, material, and lighting properties
- **Assets**: Asset browser for textures, meshes, and materials
- **Stats**: FPS, frame time, 3D batch/vertex/index/instance counters
- **Custom dark theme**: Full ImGui color scheme

Dock layout is configurable with `editor.setup_default_dock_layout()`, persisted in `imgui.ini`.

{{< image-placeholder "ImGui editor with viewport, scene hierarchy, inspector, and asset browser panels" >}}

### Hot-Reload Architecture

Mixel uses a **cradle/dylib** pattern for live editing: the engine runs in a cradle executable, while game code is compiled as a dynamic library. The `hot_reload_api.odin` defines a function-pointer table (`Mix_API_V1`) that the cradle hands to the dylib at startup — no linker dependencies, no duplicated globals across the boundary. After recompilation, the cradle reloads the dylib while keeping the GPU context and mixer state alive.

---

## Examples

The repository includes **85+ examples** across progressive phases, features, effects, arcade ports, and 3D scenes:

- **Phase 1–10**: Boot, camera/sprite, input/collision, tilemap, HUD/tween, audio, effects/particles, animation/assets, gamepad/camera FX, core surfaces
- **Features**: Box2D, camera box2d, tilemap towns
- **Effects**: Blur, bloom, color replace, crack, crumple, custom shader, edge glow, film roll, filters, fire, glitch, glow, knock, outline, pixel extend, pixel melt, pixel shockwave, pixelize, rain, raindrops, scribble, scanner, shade, swirl, tilt, trail, vignette, wave, wiggle
- **Arcade ports**: Breakout, Flappybalt, Zombie Sniper, and more
- **3D**: 25+ examples covering cubes, lights, textures, primitives, instancing, shadows, PBR, glTF, FPS, morph targets, physics, toon shading, billboards, parenting, and the editor sandwich

{{< image-placeholder "Grid of example screenshots — phase demos, arcade ports, effects, and 3D scenes" >}}

---

## Key Results

| Metric | Value |
|---|---|
| **Language** | Odin |
| **Framework LOC (mixel/)** | ~18,000 lines |
| **3D layer LOC** | ~6,400 lines (three_d.odin) |
| **Backends** | SDL3 GPU (primary), raylib (2D fallback) |
| **Update loop** | Fixed timestep with independent draw Hz |
| **State system** | Ordered layers + substate stacking |
| **3D lighting** | Unlit, Lambert, PBR, Toon |
| **3D shadows** | Directional shadow maps with PCF |
| **3D post-effects** | 8 built-in (invert, tint, vignette, grayscale, sobel, halftone, dither, hatching) |
| **3D formats** | glTF/GLB + OBJ/MTL |
| **3D animations** | Skinned glTF with CPU skinning |
| **3D billboards** | Full-facing and axis-Y |
| **2D effects** | 30+ shader effects |
| **Examples** | 85+ (10 phase, 30+ effects, 20+ arcade/features, 25+ 3D) |
| **Editor** | ImGui dockable panels, viewport, hot-reload cradle |
| **Audio** | Sound + music loading, playback, fading, groups |
| **Tween** | 30+ easing functions, looping, ping-pong, chaining |
| **Windowing** | SDL3 (default), raylib (fallback) |
| **Platform** | macOS, Linux, Windows |
| **Build** | `odin run example -collection:mixel=.` |
| **Tests** | Unit tests in `tests/unit/` |

---

## Current Status

The 2D core is mature — sprites, animation, cameras, tilemaps, collision, tweens, audio, text, particles, effects, transitions, save data, gamepad input, and debugger are all functional. The 3D layer is actively expanding with new features shipping regularly (PBR, shadow maps, skinned animation, glTF, post-processing). The editor is in progress — the ImGui viewport, dock layout, stats overlay, and hot-reload cradle are working, with the full scene/inspector/assets panels under development.

**Built in Odin. ~18,000 lines of framework code. 85+ examples. 2D + 3D + editor.**
