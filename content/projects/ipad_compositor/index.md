---
title: "Mixture — iPad Node-Based Compositor & 3D Motion Graphics"
description: "A node-based image compositing and 3D motion graphics application for iPad, built from scratch in Swift and Metal. Features a custom node graph engine, GPU-accelerated PBR rendering, Apple Pencil interaction, and an ACES color pipeline."
tech: ["Swift", "SwiftUI", "Metal", "CoreImage", "Metal Shading Language", "ACES"]
featured: true
weight: 2
---

## What Is It?

Mixture is a node-based compositing and motion graphics app that runs entirely on an iPad. Think Nuke or Fusion reimagined for a touch screen — you build visual effects by connecting nodes in a graph, each node performing one operation (a blur, a color grade, a 3D render), and the result flows through the chain in real time.

What makes it unusual is that everything runs on-device. There's no cloud rendering, no desktop companion app — the same iPad you draw on runs a full Metal PBR renderer, a 38-node compositing engine with ACES color management, and a timeline animation system. The whole thing is built from scratch in Swift and Metal, with zero third-party rendering libraries. I wanted to see whether a professional-grade compositing tool could feel native on a tablet, or whether the desktop-heavy VFX industry had good reasons for never trying.

## Why Did I Build It?

I've spent years working with node-based compositors like Nuke and Fusion, and I've always been frustrated that the industry's most creative tooling is welded to a desk. The iPad Pro has a screen that rivals professional reference monitors, a stylus with pixel-level precision, and a GPU that can run desktop-class Metal shaders — yet the best creative apps on it are painting and drawing tools, not compositing systems. I wanted to know if the gap was real or just inertia. So I built the thing I wished existed: a node graph in my lap, with Apple Pencil instead of a mouse, and a full 3D pipeline that didn't need a tower under the desk.

## What Did I Learn?

**3D-first was the right call, but it made everything harder.** I decided early that the compositing pipeline would be 3D-native — 2D images project onto ImagePlane geometry, blends happen in 3D space, and the viewport is a real PBR scene. This means every composite is inherently a 3D render, which gives you free depth, camera animation, and true lighting integration. But it also means that a simple two-image blend requires a geometry pass, a material evaluation, a lighting calculation, and a render-to-texture step. For a while, the simplest operations took 5x the GPU work they should have. I had to add an optimization path that detects pure 2D subgraphs and flattens them into a direct Core Image filter chain, bypassing the 3D pipeline entirely.

**Cache invalidation on a directed graph is deceptively subtle.** The naive approach — invalidate everything downstream of a change — works until you have a graph with 38 node types, animation curves feeding multiple parameters, and a user scrubbing the timeline at 60 fps. A single parameter change on an upstream node could dirty the entire scene graph. I ended up building a dependency-tracking cache store that marks only the changed node and its transitive dependents, while preserving upstream results. Even then, I missed edge cases where a node used a parameter from another node's output (not just a direct connection), which meant stale values survived invalidation. That took two rewrite passes to fix.

**Apple Pencil and fingers want completely different gesture models, and fighting UIKit's gesture recognizer system was the wrong approach.** I initially tried to handle all touch input through SwiftUI's gesture modifiers. That broke down immediately — SwiftUI couldn't distinguish a pencil tap (select a node) from a finger tap (pan the canvas) without complex hit-testing workarounds. I ripped it out and built a UIKit gesture recognizer bridge that assigns `allowedTouchTypes` explicitly: pencil is for node-level interactions (tap, drag to connect, double-tap for radial menu), fingers are for canvas navigation (pan, pinch to zoom, rotate). The bridge forwards recognized gestures to SwiftUI via a delegate protocol. It's more code, but the interaction model is clean and predictable — and it taught me that UIKit and SwiftUI can coexist when you give them clear boundaries.

**ACES color management on mobile is feasible, but the practical benefit depends on the output.** I implemented a full ACES pipeline with 7 working color spaces and configurable view transforms. The math is straightforward (a sequence of 3x3 matrices and 1D LUTs), and Metal handles it easily. But the honest truth is that for an iPad app whose primary output is H.264 or ProRes, the difference between ACEScg and linear sRGB is invisible in most real-world workflows. The real value is in the pipeline's structure — having a well-defined working space and output transform means the compositing math is consistent regardless of input format, which matters more for correctness than for visual quality.

**Building your own node graph engine from scratch is satisfying but you'll reimplement every bug Nuke already fixed.** The core graph data structure — directed acyclic graph with typed ports, connection validation, and topological sort — is maybe 400 lines of Swift. That's not the hard part. The hard part is everything around it: copy-paste with full connectivity restoration, undo/redo that doesn't leave dangling connections, serialization that survives node registry changes, and a UI that renders 50+ nodes at 120 fps without layout glitches. I spent more time on those "details" than on the entire Metal renderer combined.

## Key Results

| Metric | Value |
|---|---|
| **Node graph engine** | Custom DAG with typed ports, cycle detection, topological evaluation |
| **3D renderer** | Forward PBR with Cook-Torrance BRDF, shadow mapping, multi-pass extraction |
| **Node types** | 38 across 13 categories (input, filter, color, matte, 3D, merge, etc.) |
| **Animation** | Frame-based timeline, 6 interpolation types, bezier tangents, auto-key |
| **Color pipeline** | 7 ACES color spaces, configurable view transforms, channel isolation |
| **Blend modes** | 24 in a single Merge node (Over, Add, Multiply, Screen, etc.) |
| **Interaction** | Separate Apple Pencil and finger gesture models via UIKit bridge |
| **Geometry** | 6 procedural types + USD/USDZ import with texture extraction |
| **Metal shaders** | 5 (PBR, Shadow, Multi-Pass, Viewport, Checkerboard) |
| **Export** | Image sequences (PNG, JPEG) + video (H.264, H.265, ProRes) |
| **Dependencies** | Zero third-party rendering or compositing libraries |
| **Language** | Swift + Metal Shading Language |

## Screenshots / Media

<!-- SCREENSHOT 1: The node graph canvas on iPad with a compositing tree of 8-10 connected nodes, showing a 3D render node feeding into a color grade then a merge. Caption: "Building a composite in the node graph — each node is a single operation, wires carry images, 3D scenes, materials, or masks between them." -->
<!-- SCREENSHOT 2: The 3D viewport showing a PBR-lit scene with shadow mapping, multi-pass output panel (Beauty, Depth, Normals) visible alongside. Caption: "The 3D viewport rendering a procedural scene with Cook-Torrance shading, PCF shadow maps, and extractable auxiliary passes." -->
<!-- SCREENSHOT 3: The timeline panel with keyframe diamonds, animation curves, and transport controls below a node graph. Caption: "Frame-based timeline with keyframe animation — any node parameter can be driven by bezier-interpolated curves across the project's frame range." -->

## Technical Deep Dive

For the engineers wondering how this actually works under the hood — here is the full architecture, the decisions that shaped it, and the parts that took the longest to get right.

### Architecture Overview

The app is organized into four Swift packages, each with a clear dependency direction:

```
┌─────────────────────────────────────────────────────┐
│  MIXUI                                              │
│  SwiftUI interface: node canvas, viewport, timeline, │
│  radial menus, gesture bridge, inspectors            │
└──────────────────────┬──────────────────────────────┘
                       │ depends on
┌──────────────────────▼──────────────────────────────┐
│  MIXNodes                                           │
│  38 node implementations across 13 categories,      │
│  each registered via a type-safe NodeRegistry        │
└──────────────────────┬──────────────────────────────┘
                       │ depends on
┌──────────────────────▼──────────────────────────────┐
│  MIXRendering                                        │
│  Raw Metal renderer: forward PBR pipeline,           │
│  shadow mapping, multi-pass extraction, viewport,    │
│  export encoding                                     │
└──────────────────────┬──────────────────────────────┘
                       │ depends on
┌──────────────────────▼──────────────────────────────┐
│  MIXCore                                             │
│  Foundation: NodeGraph model, evaluation engine,     │
│  scene 3D types, animation system, color management, │
│  file I/O, serialization                             │
└─────────────────────────────────────────────────────┘
```

MIXCore has zero UI dependencies and can be unit-tested independently. MIXNodes registers node types into a shared `NodeRegistry` — adding a new node type doesn't require touching any other package.

### The Evaluation Engine: Pull-Based with Smart Caching

The evaluator doesn't push data through the graph. Instead, it starts at the requested output node (typically a Viewer or Render3D node) and recursively evaluates backward through its inputs. Each node produces a `NodeResult`, which is one of six concrete types:

```swift
public enum NodeResultType {
    case image      // CIImage-based pixel data
    case scene      // Scene3D graph (geometry tree + lights + camera)
    case mesh       // Single Mesh3D (vertex + index data)
    case material   // PBR material parameters
    case camera     // Camera node (fov, transform, dof params)
    case light      // Light node (type, color, intensity, shadow config)
}
```

The evaluator walks the graph using a topological ordering computed at evaluation time. The `CacheStore` maintains a dictionary of `NodeID → CacheEntry`, where each entry holds the computed result and a generation counter. When a node is invalidated, only its cache entry and its transitive dependents are cleared — upstream results remain untouched:

```swift
public func invalidateNode(_ nodeID: NodeID) {
    guard cacheStore[nodeID] != nil else { return }
    cacheStore.removeValue(forKey: nodeID)
    for dependent in graph.downstreamDependents(of: nodeID) {
        cacheStore.removeValue(forKey: dependent)
    }
}
```

The `downstreamDependents` function runs a reverse topological traversal from the invalidated node, collecting every node that could be affected. This is cheap because the graph's adjacency structure is maintained as both forward and reverse edge sets:

```swift
public struct NodeGraph {
    private var nodes: [NodeID: Node] = [:]
    private var forwardEdges: [NodeID: Set<NodeID>] = [:]   // output → input
    private var reverseEdges: [NodeID: Set<NodeID>] = [:]   // input → output
}
```

### Why 3D-Native Compositing (And the Optimization It Required)

The decision to make compositing 3D-native was architectural, not cosmetic. In a traditional 2D compositor, every node operates on 2D image data — a Merge node blends two images, a Transform node warps an image, and the 3D renderer is just one node type among many. In Mixture, the scene graph is the compositing graph. A 2D image enters the 3D pipeline the moment it's projected onto an ImagePlane geometry, and everything after that — blending, depth sorting, lighting — is a 3D operation.

This means a composite like "Put a logo over a background with a drop shadow" involves: creating two ImagePlane geometries, applying materials with albedo textures, positioning them in 3D space with a Transform3D node, merging them with Merge3D (which does a depth-aware composite), and rendering the result through a Render3D node with a PBR pass. That's correct and flexible, but it's expensive for flat 2D work.

The optimization: when the evaluator detects that a Render3D node's input subgraph contains no actual 3D geometry (everything is ImagePlane with no depth overlap, no lighting, no shadows), it extracts the compositing chain and evaluates it as a flat sequence of Core Image filters, bypassing the Metal render target entirely. The detection is a single graph traversal that checks for Shape3D, Light3D, or Merge3D nodes with actual depth separation — if none exist, the subgraph is "2D-safe" and takes the fast path.

### PBR Shading Pipeline

The Metal renderer implements a forward PBR loop with Cook-Torrance BRDF. Each frame executes two passes:

1. **Shadow pass:** Renders the depth buffer from each shadow-casting light's perspective using a separate shadow pipeline. The shadow map uses percentage-closer filtering (PCF) with a 4×4 sample kernel for soft edges.

2. **Color pass:** Renders all drawables with the PBR fragment shader. Per-fragment, the shader computes:
   - **Ambient term** (IBL-projected environment, or a flat ambient color)
   - **Diffuse term** (Lambertian, modulated by shadow map visibility)
   - **Specular term** (GGX distribution, Smith geometry, Schlick Fresnel)

The fragment function uses Metal function constants to compile specialized pipeline variants, avoiding runtime branching for features like albedo textures or shadow map sampling:

```metal
fragment float4 pbr_fragment(
    PBRVertexOut in [[stage_in]],
    constant SceneUniforms &uniforms        [[buffer(0)]],
    constant MaterialData &material         [[buffer(1)]],
    constant uint &lightCount               [[buffer(2)]],
    constant LightData *lights              [[buffer(3)]],
    texture2d<float> albedoTex              [[texture(0), function_constant(hasAlbedoTex)]],
    texture2d<float> shadowMap              [[texture(2), function_constant(hasShadowMap)]]
) {
    float3 albedo = hasAlbedoTex ? albedoTex.sample(sampler, in.uv).rgb : material.albedo.rgb;
    float3 N = normalize(in.worldNormal);
    float3 V = normalize(uniforms.cameraPosition - in.worldPos);
    float3 F0 = mix(float3(0.04), albedo, material.metallic);

    float3 Lo = 0;
    for (uint i = 0; i < lightCount; i++) {
        float3 L = normalize(lights[i].position - in.worldPos);
        float3 H = normalize(V + L);
        float shadow = hasShadowMap ? pcfShadow(shadowMap, in.shadowCoord) : 1.0;
        Lo += cookTorranceBRDF(N, V, L, H, F0, material.roughness, material.metallic, albedo)
            * lights[i].color * lights[i].intensity * shadow;
    }
    return float4(Lo + uniforms.ambient * albedo, 1.0);
}
```

### The Node Registry Pattern

Nodes are not hardcoded into the evaluation engine. Instead, each node type registers itself into a shared `NodeRegistry` at startup:

```swift
// Each node file calls this from a static initializer
NodeRegistry.shared.register(
    NodeRegistryEntry(
        typeName: "Blur",
        category: .filter,
        inputPorts: [
            PortDefinition(portID: "input", dataType: .image, label: "Src"),
        ],
        outputPorts: [
            PortDefinition(portID: "output", dataType: .image, label: "Out"),
        ],
        parameterDefinitions: [
            ParameterDefinition(name: "radius", type: .float, defaultValue: .float(5.0),
                                range: 0...100),
            ParameterDefinition(name: "direction", type: .enumeration,
                                defaultValue: .enumeration("Gaussian"),
                                enumOptions: ["Gaussian", "Horizontal", "Vertical"]),
        ],
        evaluator: { node, ctx in BlurNode.evaluate(node: node, context: ctx) }
    )
)
```

The registry maps type names to entries, so serialization stores only the string `"Blur"` — if the node implementation changes, old project files still load. The evaluator is a closure stored in the entry, so adding a node type never requires modifying the evaluation engine.

### Touch Interaction: Why Not SwiftUI Alone

SwiftUI's gesture system doesn't expose `allowedTouchTypes`. Without it, you can't distinguish a pencil tap from a finger tap in a gesture modifier — both arrive as `DragGesture` or `TapGesture` with no way to check the input device. This matters because a pencil tap should select a node (precision interaction), while a finger tap on the same spot should pan the canvas (navigation interaction).

The solution was a `UIKit` gesture recognizer bridge that assigns types explicitly:

```swift
public class PencilGestureBridge: NSObject {
    private let pencilTap = UITapGestureRecognizer(target: self, action: #selector(handlePencilTap))
    private let pencilDoubleTap = UITapGestureRecognizer(target: self, action: #selector(handlePencilDoubleTap))
    private let fingerPan = UIPanGestureRecognizer(target: self, action: #selector(handleFingerPan))
    private let fingerPinch = UIPinchGestureRecognizer(target: self, action: #selector(handleFingerPinch))

    public override init() {
        super.init()
        pencilTap.allowedTouchTypes = [.pencil]
        pencilDoubleTap.allowedTouchTypes = [.pencil]
        pencilDoubleTap.numberOfTapsRequired = 2
        fingerPan.allowedTouchTypes = [.direct]
        fingerPinch.allowedTouchTypes = [.direct]
    }
}
```

Recognized gestures are forwarded to SwiftUI via a delegate pattern that updates `@Published` state on the bridge object. The SwiftUI layer observes these and responds — selecting nodes, drawing connection wires, or transforming the canvas. The bridge also handles free-form pencil strokes for gesture shortcuts: drawing an "X" deletes the selected node, drawing a line between two nodes creates a connection, and lasso strokes select multiple nodes.

### Animation: Parameter Evaluation Across Frames

The animation system is built into the `EvaluationContext`. Every parameter lookup is frame-aware:

```swift
public func parameterValue(for nodeID: NodeID, name: String, atFrame frame: Int) -> ParameterValue? {
    guard let track = animationData.track(for: nodeID, parameterName: name) else {
        return node.parameters[name]?.defaultValue  // static fallback
    }
    return track.interpolatedValue(at: frame)
}
```

Keyframe tracks support 6 interpolation modes, each implemented as a function over the normalized time `t ∈ [0, 1]`:

- **Linear:** `t`
- **Ease In:** `t²`
- **Ease Out:** `1 - (1 - t)²`
- **Ease In/Out:** `t² / (t² + (1 - t)²)`
- **Stepped:** `t < 1 ? 0 : 1`
- **Bezier:** Cubic bezier evaluated via De Casteljau's algorithm using `inTangent`/`outTangent` control points

The bezier interpolation was the hardest to get right — the tangent handles are stored as `(dx, dy)` offsets from the keyframe, and the curve is re-parameterized by arc length to ensure uniform velocity. Without arc-length re-parameterization, bezier animation appears to speed up and slow down between keyframes even when the tangents are symmetric.
