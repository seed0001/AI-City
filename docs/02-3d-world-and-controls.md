# 3D world and controls

This document describes the **client-side 3D layer**: how the canvas is set up, how the map loads, how the **player** moves, and how **NPCs** are represented in the world (VRM, placement).

## Entry points

- **`App.tsx`**: Mounts `CitySimProvider`, `TownLayoutProvider`, the **Scene** (suspended for GLTF/VRM), **LeftHud**, and **CitySimDebugPanel**.
- **`src/scene/Scene.tsx`**: R3F `Canvas` configuration — tone mapping, exposure, shadows, DPR, performance monitor, children (map, environment, sim visuals, walk controls, etc.).

## Rendering and performance

- **Color space & tone mapping**: e.g. ACES filmic, sRGB output — see `Scene.tsx` `gl` config and `onCreated` exposure.
- **Adaptive DPR and events** (`@react-three/drei`): `AdaptiveDpr` / `AdaptiveEvents` to reduce work on heavy frames.
- **Map asset**: The main environment model is served from `public/models/` (e.g. `BurgerPiz.glb`). `BurgerPizModel` computes **bounds** for centering, framing, and for **walk constraints**.

## First-person walk

- **Pointer lock** is used for look; movement uses keyboard input and map **bounds** once they are available (see `WalkControls.tsx`, `WalkSpawn.tsx`).
- Speed and feel are defined in the scene (e.g. a walk speed constant in `Scene.tsx`); **Shift** often increases speed — verify in the current `WalkControls` implementation.
- The **player’s** world position and rotation are fed into **`CitySimManager.tick`**, so the in-world “resident” entity matches the camera rig.

## Town layout in the 3D scene

- **Layout mode** (vs simulation) is driven by `TownLayoutContext` and **`TownLayoutScene`**: you place **preset markers** in the world, validate, save.
- **Markers** map to logical **city locations** in the sim via `townLayout/markerToLocations.ts` and related code.
- **Hotkeys** (when a marker is selected, focus not in a text field): **Delete** / **Backspace** to remove a marker (see `TownLayoutEditorPanel`).

## VRM residents

- NPCs (and the player-side representation where applicable) can use **VRM** files under `public/models/npc/` (e.g. Luna, Bob, Sarah, additional assets as added in the repo).
- Components in `src/systems/citySim/components/npc/` (e.g. `LunaVrmNpc`, `BobVrmNpc`, `SarahVrmNpc`) load and animate VRMs; they tie into entity ids / seeds from `data/townCharacters.ts` and the live **`TownEntity`** registry.
- **VRMA** (animation) assets can be paired with the runtime **@pixiv/three-vrm-animation** support where wired.

## City sim visuals

- **`CitySimVisuals.tsx`** and **`CitySimLoop`** bridge simulation state to the scene: loop runs inside `useFrame` and calls the manager’s **`tick`**, so NPCs and effects stay in sync with the render frame.

## Environment and world dressing

- **`Lighting`**, **`Ground`**, **`EnvironmentLayer`**: lighting rigs, ground plane, and HDRI/IBL-style environment where configured.
- **`NightSky`**: Procedural or shader-driven **night sky** (see `nightSkyShader.ts`, `skyConstants.ts`).

## Debugging the 3D + sim

- **City sim debug** panel: entity snapshot, timing — useful to confirm the player entity and NPCs match world positions and that `simulationEnabled` is on.
- If models fail to load, check the **browser console** and that paths under `public/models/` match imports.

## Files to read first (3D)

| File | Why |
| ---- | --- |
| `src/scene/Scene.tsx` | Canvas, R3F setup, child composition |
| `src/scene/BurgerPizModel.tsx` | GLB load, bounds |
| `src/scene/WalkControls.tsx` | Input, movement |
| `src/systems/citySim/components/townLayout/TownLayoutScene.tsx` | 3D placement of markers |
| `src/systems/citySim/components/npc/*VrmNpc.tsx` | VRM per character |
