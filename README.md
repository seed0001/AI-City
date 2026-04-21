# AI City — BurgerPiz Viewer

A React + Three.js app that loads and renders the `BurgerPiz.glb` 3D map with
proper PBR lighting, HDRI environments, and runtime controls.

Built with:

- **Vite** + **React 18** + **TypeScript** (strict)
- **react-three-fiber** — declarative Three.js in React
- **@react-three/drei** — `useGLTF`, `OrbitControls`, `Environment`,
  `ContactShadows`, `useProgress`
- **leva** — live debug panel (lighting / exposure / environment)

## Getting started

```bash
npm install
npm run dev
```

Open http://localhost:5173.

## Project layout

```
AI city/
├── public/
│   └── models/
│       └── BurgerPiz.glb       # copied from BurgerPiz/BurgerPiz/Models
├── src/
│   ├── scene/
│   │   ├── Scene.tsx           # Canvas, camera, controls, env, toneMapping
│   │   ├── BurgerPizModel.tsx  # GLTF loader, auto-center, auto-frame camera
│   │   ├── Lighting.tsx        # key / fill / rim, shadow cam tuned
│   │   └── Ground.tsx          # contact shadow catcher
│   ├── ui/
│   │   ├── LoadingOverlay.tsx  # progress bar driven by useProgress
│   │   ├── TopBar.tsx
│   │   └── ControlsHint.tsx
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css
├── index.html
├── vite.config.ts
├── tsconfig.json
└── package.json
```

## Design notes

- **Format.** Only `BurgerPiz.glb` is bundled — GLB is the right web format
  (smaller, standardized, textures embedded). The `.fbx` / `.dae` copies in
  the source folder are intentionally excluded.
- **Auto-framing.** On load the model's bounding box is measured; the model
  is re-centered and sunk to `y = 0`, and the camera is placed at a distance
  derived from the FOV so the map always fits in view.
- **Rendering.** `ACESFilmicToneMapping` + `SRGB` output, HDRI environment
  via drei's `Environment` preset (switchable in the Leva panel), soft
  `ContactShadows` and a tuned directional shadow camera.
- **Performance.** `AdaptiveDpr` + `AdaptiveEvents` + `PerformanceMonitor`
  downscale gracefully on weaker GPUs. `Preload all` warms caches.

## Build

```bash
npm run build
npm run preview
```
