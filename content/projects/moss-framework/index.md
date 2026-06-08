---
title: "Moss — A Lightweight 2D/3D Game Framework in C"
description: "A C + SDL3 game framework with batched 2D/3D GPU rendering, Box2D physics, scene management, tween animation, audio mixing, and a Flixel-inspired object hierarchy — built from scratch guided by AI pair programming."
tech: ["C", "SDL3", "Box2D", "Metal"]
weight: 2
---

## Overview

Moss is a **lightweight, modern 2D/3D game framework** built on SDL3's GPU API. It combines the ease of Flixel or Phaser with the power of native code — batched 2D sprite rendering, 3D depth rendering with lighting, Box2D physics, scene lifecycle management, tween animation, audio mixing, procedural texture generation, and custom shader support.

The framework is written in **C (C17)** and is roughly **~4,000 lines of implementation** across 16 modules — no C++ overhead, no reflection, no scripting language. AI was used to help solve specific areas (the GPU batching pipeline, the audio mixing engine, and the 3D projection math), but the architecture, API design, and most of the implementation were done by hand.

---

## Design Philosophy

Moss was inspired by the ergonomics of **Flixel/Phaser** (game object hierarchies with velocity/drag/collision built-in) and **Raylib** (all-in-one header simplicity), combined with a modern GPU backend that handles both 2D and 3D in the same render pass.

Key design decisions:

- **Single-header include**: `#include <moss/moss.h>` gives you everything
- **Explicit context**: All APIs take a `MossApp*` — no global state
- **Unprefixed names**: Only `MossApp`/`MossConfig` carry the `Moss` prefix — types are `Vec2`, `Color`, `Rect`, `Scene`, `Sprite`
- **GPU-first rendering**: SDL3 GPU API (Metal on macOS, Vulkan/D3D12 elsewhere) — no software fallbacks, no legacy pipelines
- **Zero external assets at startup**: Built-in 8x8 bitmap font, 1x1 white texture for shape rendering

---

## Architecture

```
include/moss/
├── moss.h        # Umbrella header (includes everything below)
├── types.h       # Vec2/3/4, Mat4, Color, Rect — core types
├── math.h        # Vector/matrix ops, lerp, clamp, rand
├── app.h         # MossApp, MossConfig, lifecycle, logging
├── input.h       # Keyboard, mouse, gamepad
├── scene.h       # Scene lifecycle callbacks
├── draw2d.h      # Batched 2D rendering (shapes, sprites, text)
├── draw3d.h      # 3D rendering with depth and lighting
├── camera.h      # Camera2D, Camera3D
├── object.h      # Object/Sprite/Group hierarchy
├── physics.h     # AABB collision with separation
├── box2d.h       # Box2D physics integration wrapper
├── assets.h      # Texture/shader/sound loading + procedural generation
├── audio.h       # Sound loading and playback
├── tween.h       # Property tweening with 13 easing types
└── tilemap.h     # Tilemap loading and rendering
```

The app owns all subsystems — input state, 2D/3D renderers, asset manager, tween manager, audio state — all accessed through `MossApp*`. The scene lifecycle dispatches `on_create` / `on_update` / `on_render` / `on_destroy` callbacks every frame, with deferred scene switching at frame boundaries.

---

## Minimal Example

```c
#include <moss/moss.h>

void render(MossApp *app) {
    begin_2d(app, NULL);
    draw_rect(app, RECT(100, 100, 200, 150), RED);
    draw_text(app, "Hello Moss!", VEC2(10, 10), 24, WHITE);
    end_2d(app);
}

int main() {
    MossApp *app = create_app(&(MossConfig){
        .title = "My Game",
        .width = 800, .height = 600,
        .target_fps = 60,
        .clear_color = CORNFLOWER_BLUE,
    });
    run(app, &(Scene){ .on_render = render });
    destroy_app(app);
    return 0;
}
```

That's it. No build system beyond CMake, no asset pipeline, no config files.

---

## The Render Pipeline

### Frame Lifecycle

Each frame executes in this order:

1. **Timing** — delta time calculation, frame limit
2. **Input** — copy previous frame state, poll SDL events
3. **Scene switch** — deferred scene destruction/creation at frame boundary
4. **Group auto-update** — Scene root group applies velocity/drag to all child objects
5. **User update** — `on_update` callback (handles input, game logic, physics steps)
6. **Tween update** — all active tweens interpolate
7. **User render** — `on_render` callback (user calls `begin_2d`/`draw_*`/`end_2d`)
8. **GPU submission** — acquire command buffer + swapchain, upload vertices, submit

### 2D/3D Pass Management

When 3D draw calls are detected, the renderer splits the frame into two GPU render passes:

```c
// app.c — render phase (simplified)
if (renderer3d_has_data) {
    // Pass 1: 3D with depth buffer (CLEAR)
    SDL_BeginGPURenderPass(cmd, &color_target, 1, &depth_target);
    renderer3d_draw(...);
    SDL_EndGPURenderPass(pass3d);

    // Pass 2: 2D overlay (LOAD existing color, no depth)
    SDL_BeginGPURenderPass(cmd, &color_target_2d, 1, NULL);
    renderer2d_draw(...);
    SDL_EndGPURenderPass(pass2d);
} else {
    // 2D only: single pass with clear
    SDL_BeginGPURenderPass(cmd, &color_target, 1, NULL);
    renderer2d_draw(...);
    SDL_EndGPURenderPass(pass);
}
```

The depth buffer is lazily allocated — only when 3D is first used.

---

## 2D Renderer

### Sprite Batcher

The 2D renderer is a CPU-side vertex builder with GPU batching:

```c
#define MAX_QUADS 8192

typedef struct Vertex2D {
    f32 px, py;          // position
    f32 tx, ty;          // texcoord
    f32 cr, cg, cb, ca;  // color
} Vertex2D;
```

The batcher queues quads into a vertex buffer, grouping them into batches that break on texture or shader changes. At `end_2d`, all vertices are uploaded to the GPU via a transfer buffer and drawn in a single indexed draw call per batch (or more if multiple textures/shaders were used during the frame).

Key details:
- 32 bytes per vertex, 128 bytes per quad (4 verts), 6 indices per quad
- Two triangles per quad, indexed for reuse
- 1x1 white texture for solid-color shapes (rects, circles, lines, triangles) — same pipeline, no texture switch
- Rotation computed CPU-side per vertex (cos/sin transform on 4 corners)
- Per-vertex tint color (multiplied by texture sample in the fragment shader)

### MSL Shaders

Shaders are embedded as C string literals — no external files at compile time, no runtime compilation step:

```c
// Vertex shader (embedded in C source)
static const char *msl_vertex_shader =
    "vertex VertexOut vs_main(...) {\n"
    "    out.position = uniforms.view_projection * float4(in.position, 0.0, 1.0);\n"
    "    out.color = in.color;\n"
    "    out.texcoord = in.texcoord;\n"
    "}\n";

// Fragment shader
static const char *msl_fragment_shader =
    "fragment float4 fs_main(...) {\n"
    "    return tex.sample(smp, in.texcoord) * in.color;\n"
    "}\n";
```

SDL3's GPU API compiles these MSL sources into the Metal pipeline at runtime. On Vulkan/D3D12, SDL_shadercross would handle HLSL-to-SPIRV translation.

### Custom Fragment Shaders

Any draw call can use a custom fragment shader:

```c
ShaderHandle wave = load_shader(app, "shaders/wave.metal");
draw_texture_opts(app, &(DrawTextureOptions){
    .texture = texture,
    .position = VEC2(100, 100),
    .tint = WHITE,
    .shader = wave,
});
```

The renderer switches pipelines mid-batch, creating a new pipeline with the custom fragment shader, rendering the textured quad, then restoring the default pipeline.

---

## 3D Renderer

The 3D renderer is a simpler non-indexed pipeline with depth testing, backface culling, and directional lighting:

```c
typedef struct Vertex3D {
    f32 px, py, pz;    // position
    f32 nx, ny, nz;    // normal
    f32 cr, cg, cb, ca; // color
} Vertex3D;

#define MAX_3D_VERTICES 65536
```

The fragment shader computes a simple directional + ambient lighting model:

```c
"float3 light_dir = normalize(float3(0.5, -1.0, 0.3));\n"
"float ndl = max(dot(normalize(in.normal), -light_dir), 0.0);\n"
"float ambient = 0.3;\n"
"float lighting = ambient + ndl * 0.7;\n"
```

Primitives include `draw_cube`, `draw_cube_wireframe`, `draw_plane`, and `draw_grid`. Cubes generate 12 triangles (36 vertices) per call, computed on the fly with face normals.

Mixed 2D/3D works by stacking render passes — the 3D pass clears both color and depth, then the 2D pass loads the existing color buffer with alpha blending and no depth test:

```c
begin_3d(app, &camera3d);    // sets up perspective + depth
draw_cube(app, VEC3(0,0,0), VEC3(2,2,2), RED);
end_3d(app);

begin_2d(app, &camera2d);    // 2D HUD overlay
draw_text(app, "Score: 100", VEC2(10,10), 20, WHITE);
end_2d(app);
```

---

## Scene & Object System

### Scene Lifecycle

```c
typedef struct Scene {
    void (*on_create)(MossApp *app);
    void (*on_update)(MossApp *app, f32 dt);
    void (*on_render)(MossApp *app);
    void (*on_destroy)(MossApp *app);
    void *user_data;
    Group *root;  // auto-updated/rendered game objects
} Scene;
```

Scenes are switched with `switch_scene(app, scene)` — the switch is deferred to the next frame boundary, so the current scene's update/render completes cleanly.

### Object Hierarchy (Flixel-inspired)

The object system uses first-field casting to implement inheritance in C:

```c
typedef struct Object {
    ObjectType type;
    b32 active, visible, alive;

    Vec2 position, size;
    f32  angle;
    Vec2 origin, scale;

    Vec2 velocity, acceleration, drag, max_velocity;
    f32  elasticity, mass;

    Rect hitbox;
    b32  immovable;
    u32  collision_mask;
} Object;

typedef struct Sprite {
    Object   base;           // first field — cast Object* to Sprite*
    TextureHandle texture;
    Colorf   color;
    f32      alpha;
    b32      flip_x, flip_y;
    BlendMode blend_mode;
} Sprite;

typedef struct Group {
    Object    base;
    Object  **members;
    u32       count, capacity;
} Group;
```

Objects auto-update their velocity/acceleration/drag physics every frame when part of a scene's root group. Sprites auto-render if visible.

### Collision

Built-in AABB collision detection with separation:

```c
// Collision with separation (objects pushed apart)
b32 collide(MossApp *app, Object *a, Object *b, CollisionCallback cb);

// Overlap detection only (no separation)
b32 overlap(MossApp *app, Object *a, Object *b, OverlapCallback cb);
```

Collision response handles:
- Separation on the axis of least penetration
- Elastic velocity exchange with per-object elasticity
- `immovable` flag (one-way separation)
- Object ↔ Object, Object ↔ Group, Group ↔ Group dispatch

---

## Box2D Physics

For full physics simulation, Moss wraps Box2D v3.1 with a pixel-coordinate layer:

```c
PhysicsWorld *world = create_physics_world(VEC2(0, 980));  // gravity in px/s²
PhysicsBody body = create_dynamic_body(world, VEC2(400, 300));
body_add_box_ex(world, body, 32, 32, 1.0f, 0.4f, 0.3f);

// Per-frame
physics_step(world, dt);
physics_sync_sprites(world);  // sync Box2D positions to attached sprites
```

The API hides the pixels-per-meter conversion (defaults to 100 PPM) and manages Box2D body/sprite attachment with an internal slot system (`MAX_BODIES = 2048`). Debug visualization draws all physics bodies with `physics_debug_draw`.

---

## Audio

Moss has a software mixing engine built on SDL3's audio stream API:

```c
#define MAX_SOUNDS  64
#define MAX_VOICES  32
#define AUDIO_FREQ  44100  // stereo float
```

The audio system:
- Loads WAV files via `SDL_LoadWAV` and converts to F32 stereo 44100
- Mixes up to 32 simultaneous voices in a callback-driven audio stream
- Each voice has independent volume
- Falls back to F32 stereo for all source formats via SDL audio conversion
- Voice stealing when all 32 slots are full (reuses slot 0)

```c
SoundHandle sfx = load_sound(app, "assets/jump.wav");
play_sound(app, sfx);                    // default volume
play_sound_ex(app, sfx, 0.5f, 1.0f, 0); // volume, pitch, pan
set_master_volume(app, 0.8f);
```

---

## Tween System

A compact tween engine with 13 easing types:

```c
// Tween from current value to target
Tween *t = tween_to(app, &player_x, 500.0f, 1.0f, EASE_BOUNCE_OUT);

// Tween with start/end
Tween *t = tween_from_to(app, &alpha, 0.0f, 1.0f, 0.5f, EASE_SINE_IN_OUT);

// Options
tween_set_delay(t, 0.3f);
tween_set_on_complete(t, my_callback, NULL);
tween_cancel(t);
tween_cancel_all(app);
```

Easing functions include: linear, quad in/out/in-out, cubic in/out/in-out, sine in/out/in-out, elastic out, bounce out, back out — implemented as one-liners in an `ease_calc` switch.

Tweens are stored in a flat array (`MAX_TWEENS = 256`) with compaction on completion.

---

## Text Rendering

Text uses a built-in 8x8 bitmap font — no external files, no font loading:

- 95 ASCII characters (32–126) packed into a 16×6 texture atlas
- Font baked from `font8x8.h` into a GPU texture at first `draw_text` call
- Multi-line support (`\n`)
- Color tint, size scaling
- `measure_text()` for layout computation

```c
draw_text(app, "Score: 100", VEC2(10, 10), 24, WHITE);
Vec2 sz = measure_text("Hello", 24);  // width × height at this size
```

---

## Asset Management

Assets are loaded with a ref-counted, path-hash-deduplicated system:

```c
TextureHandle tex = load_texture(app, "assets/player.png");
unload_texture(app, tex);  // ref-count decremented

// Procedural textures (Flixel-style)
TextureHandle checker = make_checkerboard(app, 64, 64, 8, RED, WHITE);
TextureHandle gradient = make_gradient(app, 256, 64, BLUE, GREEN, true);
TextureHandle solid = make_graphic(app, 32, 32, CORNFLOWER_BLUE);
TextureHandle raw = make_texture_from_pixels(app, pixels, w, h);

// Shader loading
ShaderHandle shader = load_shader(app, "shaders/wave.metal");
```

---

## Key Results

| Metric | Value |
|---|---|
| **Framework LOC** | ~4,000 C |
| **Compiler** | C17 (Clang, GCC, MSVC) |
| **Build system** | CMake 3.20+ with FetchContent |
| **2D batches** | Up to 8,192 quads per frame, 256 batches |
| **3D vertices** | Up to 65,536 per frame |
| **Audio voices** | 32 simultaneous |
| **Tweens** | 256 max, 13 easing types |
| **Physics** | Box2D v3.1, up to 2,048 bodies |
| **Examples** | 16 progressive examples |
| **Dependencies** | SDL3, Box2D, stb_image, cJSON |
| **GPU backends** | Metal (macOS), Vulkan/D3D12 (via SDL3) |
| **Rendering** | Batched 2D + depth-tested 3D in single swapchain |
| **Memory model** | `malloc`/`free` + transfer buffers per frame |

---

## What I Learned

Building Moss taught me more about GPU programming, real-time audio, and game engine architecture than any tutorial ever could:

1. **GPU batching is straightforward in principle, fiddly in practice.** The concept is simple (collect vertices, upload once, draw indexed), but getting texture/switching boundaries right, handling the transfer buffer lifecycle, and managing the 2D/3D pipeline split took iteration.

2. **Callback-driven audio is unforgiving.** The audio mixing callback runs on a separate thread and must complete before the buffer underruns. Missing a `memset` or having a too-slow conversion path causes audible pops. The solution was keeping the mix path dirt simple — no allocations, no locks, just float addition and clamping.

3. **First-field casting in C is surprisingly pleasant.** The Object/Sprite/Group hierarchy with type-checked dispatch made classic C-style OOP work well without macros or boilerplate. Every `object_update` / `object_render` call dispatches based on the `type` field, and `group_add` accepts any `Object*` regardless of concrete type.

4. **Embedded shaders make distribution trivial.** Shipping MSL as C string literals means zero external files at runtime and zero runtime compilation errors. The trade-off is compile-time string escaping — manageable with a small build script.

5. **SDL3's GPU API is the real deal.** It's low-level enough to make architectural decisions (transfer buffers, render passes, pipeline state) but high-level enough that 2,000 lines gives you a production-quality batched renderer with custom shader support.

The examples directory contains 16 programs ranging from a bare window to a full procedural puzzle game (`12_arrows_game`) and Box2D physics sandbox (`13_physics`) — every one a test case that drove the API design forward.

**~4,000 lines of C. No C++. No scripting language. No asset pipeline. Just compile and run.**
