---
title: "Moss — A Lightweight 2D/3D Game Framework in C"
description: "A cross-platform 2D/3D game framework in C17 with GPU-accelerated rendering, Flixel-inspired object system, Box2D physics, and a software audio mixer — all in a single-header include."
tech: ["C", "SDL3", "Box2D", "Metal"]
sourceUrl: "https://github.com/varomix/moss"
weight: 8
---

## What Is It?

Moss is a 2D/3D game framework for C — think Raylib's simplicity crossed with Flixel's game-object hierarchy, rendered through SDL3's GPU API. It's a single-header library: `#include <moss/moss.h>` gives you batched 2D rendering with sprite batching, a depth-tested 3D pipeline, a Flixel-style object system with velocity/drag/collision built into every entity, Box2D physics integration, a 32-voice software audio mixer, a tween engine with 13 easing types, and a ref-counted asset manager.

What makes Moss different from other C frameworks is the level of integration. The object system auto-updates velocity, acceleration, and drag every frame. The 2D and 3D renderers share the same swapchain and can interleave in any order — draw a 3D cube, then a 2D text overlay, without swapping targets. The audio mixer runs in a callback on a separate thread, and the tween system can animate any `float*` property with a one-liner. It's about 4,000 lines of C17, compiles with Clang, GCC, and MSVC, and ships with 16 progressive examples.

## Why Did I Build It?

I'd built game prototypes with Raylib and loved the "one header, one command" workflow, but I wanted a higher-level object model — something where sprites auto-update, collision detection is built in, and I don't have to write the same velocity/drag/physics boilerplate every time. Flixel had spoiled me. Moss was my attempt to get that experience in C without adding a scripting layer or a complex build system. The constraint was non-negotiable: single-header include, zero external assets at startup, and a build command that fits in a tweet.

## What Did I Learn?

**GPU batching is conceptually trivial and practically fiddly.** The idea is simple: collect quads into a vertex buffer, upload once, draw indexed. The implementation has to handle texture switching (break the batch, draw, start a new batch), shader switching (same thing but with a pipeline rebuild), transfer buffer lifecycle (can't write to a buffer that the GPU is still reading), and the 2D/3D pipeline split. Each of these is a 10-line fix. Finding all of them took about two weeks of examples breaking in new ways. The current code handles up to 8,192 quads across 256 batches per frame, and the last bug I fixed was a texture-atlas edge case where UV coordinates were off by half a texel on the right edge of the atlas.

**Callback-driven audio is unforgiving and I respect game audio programmers more than I did before.** The audio mixing callback runs on a separate SDL audio stream thread. It must complete before the buffer underruns — about 5ms at 44100 Hz stereo. Any allocation, any lock, any slow path causes an audible pop or click. The solution was keeping the mix path to three operations per voice: load the sample pointer, multiply by volume, add to the output buffer (with float clamping). No allocations, no condition variables, no stdlib calls. The voice stealing logic (reuse slot 0 when all 32 slots are full) runs on the main thread, not the callback. Getting this right took longer than the entire 3D renderer.

**First-field casting in C is surprisingly ergonomic.** The object hierarchy uses standard C inheritance: every game object starts with an `Object` struct as its first field, and functions cast `Object*` to `Sprite*` or `Group*` based on a `type` field. This is the pattern GLib and GTK use, and it works without any macro magic:

```c
typedef struct Object {
    ObjectType type;
    b32 active, visible, alive;
    Vec2 position, size, velocity, acceleration, drag, max_velocity;
    f32 angle, elasticity, mass;
    Rect hitbox;
    b32 immovable;
    u32 collision_mask;
} Object;

typedef struct Sprite {
    Object   base;           // cast Object* to Sprite*
    TextureHandle texture;
    Colorf   color;
    f32      alpha;
    b32      flip_x, flip_y;
    BlendMode blend_mode;
} Sprite;
```

The renderer iterates the scene's root `Group`, reads the `type` field, and dispatches to the appropriate draw function. Adding a new object type doesn't require modifying any core loop — just register it in the type dispatch table.

**Embedding Metal shaders as C string literals was the right call for distribution.** Every shader is a `static const char*` in the C source. No external files at compile time, no runtime shader compilation errors, no file-path dependency. The downside is compile-time string escaping — every newline and quote character in the MSL source needs to be escaped. I wrote a small build script that converts `.metal` files to C header string literals during the CMake configure step, so I can edit shaders normally and the embedding is automatic.

**SDL3's GPU API is the sweet spot for a small framework.** It's low-level enough that you make real architectural decisions (transfer buffers, render passes, pipeline state objects) but high-level enough that 2,000 lines of C gives you a production-quality batched renderer with custom shader support and a 2D/3D pass stack. The same API abstracts Metal, Vulkan, and Direct3D 12, so Moss runs on macOS, Windows, and Linux from the same codebase.

## Key Results

| Metric | Value |
|---|---|
| **GPU batching** | Up to 8,192 quads per frame, 256 batches, automatic texture/shader switching |
| **3D pipeline** | Depth-tested rendering with directional + ambient lighting, mixed 2D/3D in one swapchain |
| **Audio mixer** | 32-voice software mixing, callback-driven, zero-allocation hot path |
| **Object system** | Auto-update velocity/drag/physics, first-field casting inheritance |
| **Physics** | Box2D v3.1 integration with pixel-coordinate abstraction, up to 2,048 bodies |
| **Tween engine** | 256 tweens, 13 easing types, any `float*` property |
| **Text rendering** | Built-in 8x8 bitmap font atlas, baked to GPU at first call |
| **Asset manager** | Ref-counted, path-hash-deduplicated, procedural texture generation |
| **Custom shaders** | Per-draw-call fragment shader switching, embedded as C string literals |
| **Framework LOC** | ~4,000 C17 (Clang, GCC, MSVC) |
| **Examples** | 16 progressive programs from bare window to physics sandbox |
| **Dependencies** | SDL3, Box2D, stb_image, cJSON |
| **Build** | CMake 3.20+ with FetchContent |

## Screenshots / Media

<!-- SCREENSHOT 1: The 12_arrows_game example — a procedural puzzle game showing sprite rendering, collision, and text overlay on a colored background. Caption: "Procedural puzzle game built in a single example file — sprite rendering, AABB collision with separation, and bitmap text overlay, all running through the batched GPU renderer." -->
<!-- SCREENSHOT 2: The 13_physics example showing Box2D physics bodies with debug visualization — rectangles, circles, and stacked objects falling under gravity. Caption: "Box2D physics integration with debug visualization — physics bodies are drawn as wireframe overlays while Sprites track their positions via per-frame sync." -->
<!-- SCREENSHOT 3: A mixed 2D/3D frame showing a 3D cube rendered with depth testing and a 2D text HUD overlay on top, demonstrating the dual-pass rendering. Caption: "Mixed 2D/3D rendering — a depth-tested cube draws in the first pass, then the 2D HUD (text, score, debug stats) layers on top using the loaded color buffer with alpha blending." -->

## Technical Deep Dive

For the engineers wondering how a 4,000-line C framework manages a batched GPU renderer, a 32-voice audio mixer, and a physics-integrated object system — here is the full architecture, the render pipeline, and the parts that took the most iteration.

### Architecture and Frame Lifecycle

```
MossApp (owns all subsystems)
  ├── Input state (keyboard/mouse/gamepad, previous + current frame)
  ├── 2D renderer (vertex batcher, pipeline state, transfer buffers)
  ├── 3D renderer (depth buffer, non-indexed pipeline, directional light)
  ├── Asset manager (ref-counted texture/shader/sound cache)
  ├── Audio state (32 voices, callback buffer, master volume)
  ├── Tween manager (256 tweens, compaction on completion)
  └── Current Scene (on_create/on_update/on_render/on_destroy callbacks)
```

Each frame executes in this order:

1. **Timing** — delta time, frame rate limiting
2. **Input** — copy previous frame state, poll SDL events
3. **Scene switch** — deferred scene destruction/creation (queued in previous frame, executed now)
4. **Group auto-update** — root group applies velocity/drag to all child objects
5. **User update** — `on_update` callback (game logic, physics steps, input handling)
6. **Tween update** — all active tweens interpolate their target values
7. **User render** — `on_render` callback (user calls `begin_2d`/`draw_*`/`end_2d`)
8. **GPU submission** — acquire command buffer + swapchain, upload batched vertices, submit

### 2D Sprite Batcher

The 2D renderer is a CPU-side vertex builder with GPU batching. The batcher queues quads into a vertex buffer and groups them into batches that break on texture or shader changes:

```c
#define MAX_QUADS 8192

typedef struct Vertex2D {
    f32 px, py;
    f32 tx, ty;
    f32 cr, cg, cb, ca;
} Vertex2D;
```

32 bytes per vertex, 128 bytes per quad (4 verts), 6 indices per quad (two triangles, indexed). At `end_2d`, all vertices are uploaded to the GPU via a transfer buffer and drawn in indexed draw calls — one per batch (texture + shader combination).

Solid-color shapes (rects, circles, lines, triangles) use a 1×1 white texture with per-vertex tint, avoiding a texture switch. Rotation is computed CPU-side — the four corners are transformed by a per-sprite cos/sin matrix before being added to the batch.

The batch-break logic:

```c
flush_batch :: proc(renderer: ^Renderer2D) {
    if renderer.batch.quad_count == 0 return

    // Upload to GPU transfer buffer
    upload_vertex_data(renderer, renderer.batch.vertices, renderer.batch.quad_count * 4)

    // Bind pipeline (cached — only switches if shader/texture changed)
    bind_pipeline(renderer, renderer.batch.current_shader, renderer.batch.current_texture)

    // Draw indexed
    draw_indexed(renderer, renderer.batch.quad_count * 6)
    renderer.batch.quad_count = 0
}
```

### 3D Pipeline and Mixed Rendering

3D rendering uses a non-indexed pipeline with depth testing, backface culling, and a simple directional + ambient lighting model:

```c
typedef struct Vertex3D {
    f32 px, py, pz;
    f32 nx, ny, nz;
    f32 cr, cg, cb, ca;
} Vertex3D;
```

The fragment shader is intentionally simple — CAD-style technical visualization, not PBR:

```c
"float3 light_dir = normalize(float3(0.5, -1.0, 0.3));\n"
"float ndl = max(dot(normalize(in.normal), -light_dir), 0.0);\n"
"float ambient = 0.3;\n"
"float lighting = ambient + ndl * 0.7;\n"
```

Mixed 2D/3D works through render pass stacking. When 3D draw calls are detected during the frame, the renderer allocates a depth buffer and splits into two passes:

```c
if (renderer3d_has_data) {
    // Pass 1: 3D with depth (CLEAR both color and depth)
    begin_gpu_render_pass(cmd, &color_target, &depth_target, CLEAR)
    renderer3d_draw_all(...)
    end_gpu_render_pass(cmd)

    // Pass 2: 2D overlay (LOAD existing color, no depth test)
    begin_gpu_render_pass(cmd, &color_target, nil, LOAD)
    renderer2d_draw_all(...)
    end_gpu_render_pass(cmd)
} else {
    // 2D only: single pass
    begin_gpu_render_pass(cmd, &color_target, nil, CLEAR)
    renderer2d_draw_all(...)
    end_gpu_render_pass(cmd)
}
```

The depth buffer is lazily allocated on first 3D use — a 2D-only program never creates it.

### Collision Detection with Separation

Built-in AABB collision uses the axis-of-least-penetration method:

```c
b32 collide(MossApp *app, Object *a, Object *b, CollisionCallback cb) {
    if (!aabb_overlap(a->hitbox, b->hitbox)) return false

    // Find axis of least penetration
    f32 overlap_x = min_penetration(a, b, AXIS_X)
    f32 overlap_y = min_penetration(a, b, AXIS_Y)
    f32 axis = overlap_x < overlap_y ? AXIS_X : AXIS_Y

    // Separate objects along that axis
    if (!a->immovable) separate(a, b, axis, overlap)
    if (!b->immovable) separate(b, a, axis, overlap)

    // Exchange velocity components (elasticity-weighted)
    apply_collision_response(a, b, axis)

    if (cb) cb(app, a, b)
    return true
}
```

The function handles Object↔Object, Object↔Group, and Group↔Group dispatch through the type field. The `collision_mask` bitfield lets objects filter which layers they collide with — standard Flixel semantics.

### Software Audio Mixer

The audio system loads WAV files via `SDL_LoadWAV`, converts to F32 stereo 44100 Hz, and mixes up to 32 simultaneous voices in a callback-driven audio stream:

```c
#define MAX_SOUNDS  64
#define MAX_VOICES  32

audio_mix_callback :: proc(userdata: rawptr, stream: ^u8, len: i32) {
    output := cast(^f32)stream
    samples := len / size_of(f32)
    memset(output, 0, samples)  // start with silence

    for i in 0..MAX_VOICES {
        voice := &audio_state.voices[i]
        if !voice.active continue

        for j in 0..samples {
            output[j] += voice.samples[voice.position] * voice.volume
            voice.position += 1
            if voice.position >= voice.length {
                voice.active = false
                break
            }
        }
    }

    // Clamp to [-1, 1]
    for j in 0..samples {
        output[j] = clamp(output[j], -1.0, 1.0)
    }
}
```

The callback must complete within ~5ms (one audio buffer at 44100 Hz). No allocations, no locks, no function calls beyond `memset` and float ops. Voice stealing (when all 32 slots are in use, the oldest voice on slot 0 is recycled) is managed by the public API on the main thread, not in the callback.

### Tween Engine

The tween system stores all active tweens in a flat array with compaction on completion:

```c
typedef struct Tween {
    b32    active;
    f32   *target;       // pointer to the value being animated
    f32    start, end;
    f32    duration, elapsed;
    f32    delay;
    Easing easing;
    TweenCallback on_complete;
    void  *user_data;
} Tween;

#define MAX_TWEENS 256
```

Each frame, the tween manager iterates the array, advances `elapsed`, computes the interpolated value using the easing function, and writes it to `*target`. Completed tweens trigger the `on_complete` callback and are compacted out of the array.
