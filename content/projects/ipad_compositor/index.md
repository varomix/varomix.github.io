---
title: "MIXTURE — iPad Node-Based Compositor & 3D Motion Graphics"
description: "A professional node-based compositing and 3D motion graphics application for iPad with a raw Metal PBR renderer, ACES color management, 38 node types, and a full keyframe animation system — ~12,750 lines of Swift + Metal."
tech: ["Swift", "SwiftUI", "Metal", "CoreImage", "Metal Shading Language", "ACES"]
weight: 2
---

## Overview

MIXTURE is a **node-based compositing and 3D motion graphics application** purpose-built for iPad. It reimagines the desktop compositing workflow — think Nuke or Fusion — for a touch-first, Pencil-driven interface. The entire viewport is a camera looking into 3D space; all compositing happens in this 3D environment with full PBR rendering, animation, and export.

**119 Swift files + 5 Metal shaders | ~12,750 lines of code | 38 node types | 4 Swift packages**

Built entirely from scratch — no game engine, no off-the-shelf compositor library, no Unity/Unreal dependency. The application is organized into four layered Swift packages:

```
MIXCore       → Foundation: node graph, evaluation engine, scene 3D, animation, color management
MIXRendering  → Raw Metal renderer: PBR shaders, viewport, export
MIXNodes      → 38 node implementations across 13 categories
MIXUI         → SwiftUI interface: node graph canvas, viewport, timeline, radial menus, gestures
```

<!-- TODO: add video/gif -->
{{< video-placeholder "MIXTURE demo — node graph compositing, 3D viewport, and timeline animation" >}}

---

## Architecture

The entire pipeline is **3D-native**. There is no separate 2D compositing path — 2D images are projected onto ImagePlane geometry in 3D space, and all compositing occurs in the 3D scene graph:

```
Read → ImagePlane → Merge3D → Render3D → Viewer
                       ↑
               Shape3D (cube)
                       ↑
               Material3D ← Constant (albedo color)
```

### Node Graph Engine

The core data structure is a directed acyclic graph of `Node` instances connected by typed ports:

```swift
// MIXCore/Model/NodeGraph.swift
public final class NodeGraph: ObservableObject, Codable {
    @Published public private(set) var nodes: [NodeID: Node] = [:]
    @Published public private(set) var connections: Set<Connection> = []

    public func addConnection(_ connection: Connection) -> Bool {
        guard canConnect(connection) else { return false }
        connections.insert(connection)
        return true
    }
}
```

Connections are validated for type compatibility and cycle safety:

```swift
public func canConnect(_ connection: Connection) -> Bool {
    guard connection.source.nodeID != connection.destination.nodeID
    else { return false }
    guard srcPort.dataType.isCompatible(with: dstPort.dataType)
    else { return false }
    return !wouldCreateCycle(connection)
}
```

<!-- TODO: insert image -->
{{< image-placeholder "Node graph showing a compositing tree with connections" >}}

---

## Graph Evaluation Engine

The evaluator walks the graph using a **cache-aware, pull-based evaluation**. Each node produces a `NodeResult` (one of 6 types: Image, Scene, Mesh, Material, Camera, Light), and results are cached per node with targeted invalidation:

```swift
// MIXCore/Evaluation/GraphEvaluator.swift
public final class GraphEvaluator {
    public func evaluateAny(
        viewerNodeID: NodeID,
        canvasSize: CGSize,
        currentFrame: Int
    ) -> (any NodeResult)? {
        let context = EvaluationContext(
            graph: graph, cacheStore: cacheStore,
            canvasSize: canvasSize, currentFrame: currentFrame,
            animationData: animationData
        )
        context.viewportCamera = viewportCamera
        return context.evaluateAny(nodeID: viewerNodeID)
    }

    public func invalidateNode(_ nodeID: NodeID) {
        cacheStore.invalidate(nodeID)
    }
}
```

The `CacheStore` only invalidates the changed node and its downstream dependencies — upstream nodes are preserved.

---

## Metal 3D Renderer

The renderer is a **forward PBR engine** built directly on Metal, supporting **Cook-Torrance BRDF** with GGX distribution, Schlick Fresnel, and Smith geometry:

```metal
// MIXRendering/Shaders/PBRShaders.metal
float distributionGGX(float3 N, float3 H, float roughness) {
    float a  = roughness * roughness;
    float a2 = a * a;
    float NdotH  = max(dot(N, H), 0.0);
    float NdotH2 = NdotH * NdotH;
    float denom = NdotH2 * (a2 - 1.0) + 1.0;
    denom = M_PI_F * denom * denom;
    return a2 / max(denom, 0.0001);
}

float geometrySmith(float3 N, float3 V, float3 L, float roughness) {
    float NdotV = max(dot(N, V), 0.0);
    float NdotL = max(dot(N, L), 0.0);
    return geometrySchlickGGX(NdotV, roughness) *
           geometrySchlickGGX(NdotL, roughness);
}

float3 fresnelSchlick(float cosTheta, float3 F0) {
    return F0 + (1.0 - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}
```

The fragment shader combines ambient, diffuse, and specular terms per-fragment, with optional albedo/normal textures and shadow map sampling via function constants:

```metal
fragment float4 pbr_fragment(
    PBRVertexOut in [[stage_in]],
    constant SceneUniforms &uniforms,
    constant MaterialData &material,
    constant LightArray &lightArray,
    texture2d<float> albedoTexture [[texture(0), function_constant(hasAlbedoTex)]],
    texture2d<float> shadowMap [[texture(2), function_constant(hasShadowMap)]]
) { ... }
```

The Swift-side renderer manages the full pipeline — geometry upload, shadow pass, color pass with PBR lighting, and multi-pass extraction (Beauty, Depth, Normals):

```swift
// MIXRendering/Scene/SceneRenderer.swift
public func render(scene: Scene3D, camera: CameraNode3D, outputSize: CGSize) -> CIImage? {
    let drawables = prepareDrawables(scene: scene)

    // Shadow pass (for first directional light that casts shadows)
    renderShadowPass(commandBuffer: commandBuffer, drawables: drawables, ...)

    // Color pass with PBR
    renderColorPass(commandBuffer: commandBuffer, colorTexture: colorTexture,
                    drawables: drawables, viewMatrix: viewMatrix, ...)

    // Return as CIImage for compositing pipeline
    return ciContext.createCGImage(colorTexture, ...)
}
```

<!-- TODO: insert images -->
{{< image-placeholder "3D viewport showing PBR-rendered geometry with shadows" >}}
{{< image-placeholder "Multi-pass outputs: Beauty, Depth, and Normals passes" >}}

---

## 3D Scene System

The scene graph supports **6 procedural geometry types** (Cube, Sphere, Cylinder, Torus, Plane, Grid), plus **USD/USDZ import** via Model I/O with texture extraction. PBR materials provide albedo, metallic, roughness, emission, and normal maps:

```swift
// MIXCore/Scene3D/Geometry3D.swift
public enum GeometryType: String, Codable, Sendable {
    case cube, sphere, cylinder, torus, plane, grid, mesh
}

// MIXCore/Scene3D/Material3D.swift
public struct Material3D: Codable, Identifiable {
    public var albedo: simd_float4
    public var metallic: Float
    public var roughness: Float
    public var emission: simd_float4
    public var albedoTexture: URL?        // Albedo map
    public var normalTexture: URL?        // Normal map
    public var roughnessTexture: URL?
}
```

Lighting includes **point, spot, directional, and ambient** lights, all with optional shadow casting via PCF shadow mapping.

<!-- TODO: insert image -->
{{< image-placeholder "3D scene with multiple geometry types and lighting" >}}

---

## 38 Node Types

Nodes are registered through a type-safe registry. Each node defines its ports and parameters declaratively:

```swift
// MIXNodes/MergeNode.swift
public static func register() {
    let entry = NodeRegistryEntry(
        typeName: "Merge",
        category: .filter,
        inputPorts: [
            PortDefinition(portID: "A", dataType: .image, label: "Fg"),
            PortDefinition(portID: "B", dataType: .image, label: "Bg"),
            PortDefinition(portID: "mask", dataType: .mask, label: "Mask"),
        ],
        outputPorts: [
            PortDefinition(portID: "output", dataType: .image, label: "Out")
        ],
        parameterDefinitions: [
            ParameterDefinition(name: "blendMode", type: .enumeration,
                defaultValue: .enumeration("Over"),
                enumOptions: ["Over", "Add", "Multiply", "Screen", "Overlay", ...]),
            ParameterDefinition(name: "mix", type: .float, defaultValue: .float(1.0)),
        ],
        evaluator: { node, ctx in evaluate(node: node, context: ctx) }
    )
    NodeRegistry.shared.register(entry)
}
```

The evaluator for each node receives an `EvaluationContext` that provides input resolution, parameter evaluation, and frame-aware animation:

```swift
static func evaluate(node: Node, context: EvaluationContext) -> ImageResult? {
    let fgResult = context.evaluateInput(for: node.id, portID: "A")
    let bgResult = context.evaluateInput(for: node.id, portID: "B")
    let blendMode = context.parameterValue(for: node, name: "blendMode")?.stringValue ?? "Over"
    let mix = context.parameterValue(for: node, name: "mix")?.floatValue ?? 1.0

    // Map blend mode to Core Image filter
    let filter = CIFilter(name: filterName)
    filter?.setValue(fg, forKey: kCIInputImageKey)
    filter?.setValue(bg, forKey: kCIInputBackgroundImageKey)
    // ...
}
```

### Node Categories

| Category | Nodes |
|----------|-------|
| **Input** | Read, Constant, Noise, Ramp, USD Read |
| **Output** | Viewer |
| **Filter** | Blur, Sharpen, Glow, EdgeDetect, ErodeDilate, MotionBlur, AI Denoise, AI Upscale, Grain Match |
| **Color** | ColorCorrect, Grade, ColorSpace |
| **Transform** | Transform, Crop |
| **Matte** | ChromaKey, LumaKey, MagicMask, RemoveBG |
| **Convert** | Shuffle, Premult, Unpremult, Dot, Switch |
| **Merge** | Merge (24 blend modes) |
| **Geometry** | Shape3D, ImagePlane |
| **Scene 3D** | Transform3D, Merge3D |
| **Lighting** | Light3D |
| **Material** | Material3D |
| **Render 3D** | Render3D (Beauty + Depth + Normals outputs) |

---

## Animation System

A frame-based timeline drives keyframe animation at the project FPS (default 24). Every node parameter can be animated:

```swift
// MIXCore/Animation/Keyframe.swift
public struct Keyframe: Codable, Identifiable {
    public var frame: Int
    public var value: ParameterValue
    public var interpolation: InterpolationType  // linear, bezier, stepped, easeIn, easeOut, easeInOut
    public var inTangent: TangentHandle?
    public var outTangent: TangentHandle?
}

// MIXCore/Animation/KeyframeTrack.swift
public struct KeyframeTrack: Codable, Identifiable {
    public var nodeID: NodeID
    public var parameterName: String
    public var keyframes: [Keyframe]
}
```

Parameters are evaluated frame-aware throughout the graph via the `EvaluationContext`:

```swift
context.parameterValue(for: node, name: "transform.position.x")
// Returns the interpolated value at the current frame
```

The timeline UI provides transport controls, frame ruler, per-node keyframe diamonds, scrubbing, and auto-key mode.

<!-- TODO: insert image -->
{{< image-placeholder "Timeline panel with keyframes and transport controls" >}}

---

## Color Management

Full ACES color pipeline with configurable working color spaces and view transforms:

```swift
// MIXCore/Color/ColorConfig.swift
public enum ColorSpace: String, Codable, Sendable {
    case acescg, linearSRGB, sRGB, displayP3, rec709, rec2020, aces2065
}

public enum ViewTransform: String, Codable, Sendable {
    case sRGB, displayP3, rec709, raw, log, falseColor
}
```

The viewport supports **channel isolation** (view R/G/B/A/Luminance individually) and non-destructive exposure adjustment.

---

## iPad Interaction

The interaction model separates **Pencil** and **finger** gestures cleanly, all routed through a UIKit gesture recognizer bridge:

```swift
// MIXUI/Interaction/PencilGestureBridge.swift
// Pencil gestures:
let pencilTap = UITapGestureRecognizer(target: self, action: #selector(handlePencilTap))
pencilTap.allowedTouchTypes = [.pencil]

let pencilDoubleTap = UITapGestureRecognizer(target: self, action: #selector(handlePencilDoubleTap))
pencilDoubleTap.numberOfTapsRequired = 2
pencilDoubleTap.allowedTouchTypes = [.pencil]

// Finger gestures (canvas navigation):
let fingerPan = UIPanGestureRecognizer(target: self, action: #selector(handleFingerPan))
fingerPan.allowedTouchTypes = [.direct]

let fingerPinch = UIPinchGestureRecognizer(target: self, action: #selector(handleFingerPinch))
fingerPinch.allowedTouchTypes = [.direct]
```

Pencil interactions include:
- **Tap** → focus a node, select port
- **Drag** → move node, draw connection wire
- **Double-tap** → radial menu
- **Free strokes** → X-delete, line connect, wire cut, lasso selection
- **Pressure sensitivity** → parameter slider precision

<!-- TODO: insert image -->
{{< image-placeholder "Radial menu and node interaction on iPad" >}}

---

## Export

Projects export as **image sequences** (PNG, JPEG) or **video** (H.264, H.265, ProRes 422, ProRes 4444), with background rendering, progress feedback, and cancel support. Each frame evaluates the full graph through the timeline range.

---

## Key Results

| Metric | Value |
|---|---|
| **Lines of code** | ~12,750 Swift + Metal |
| **Swift files** | 119 |
| **Metal shaders** | 5 (PBR, Shadow, Multi-Pass, Viewport, Checkerboard) |
| **Node types** | 38 across 13 categories |
| **Blend modes** | 24 in Merge node |
| **Color spaces** | 7 (ACEScg, sRGB, Display P3, Rec.709, Rec.2020, ACES 2065-1) |
| **Geometry types** | 6 procedural + USD mesh import |
| **Animation** | 6 interpolation types, bezier tangents, auto-key |
| **Build time** | < 10 seconds |
| **iPad support** | Apple Pencil + finger gestures, Metal GPU, SwiftUI |

The project is fully self-contained with zero external dependencies — no game engines, no compositor SDKs, no third‑party rendering libraries.
