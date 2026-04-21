# AI City

**Repository:** [github.com/seed0001/AI-City](https://github.com/seed0001/AI-City)

A browser-based **BurgerPiz** map viewer with a lightweight **city simulation**: NPCs, a **town layout editor** (markers persisted in `localStorage`), **dialogue** (stub lines plus optional **Ollama** LLM), and a **VRM** character (Luna) in the scene. The world uses **React Three Fiber**, PBR lighting, HDRI-style environments, and a custom **night sky** shader.

## Stack

- **Vite** + **React 18** + **TypeScript**
- **react-three-fiber** / **@react-three/drei** — scene graph, GLTF/VRM, controls, environment
- **@pixiv/three-vrm** — VRM avatars
- **leva** — in `package.json` for optional future panels (not wired in the current UI)

## Requirements

- **Node.js** 18+ (recommended for Vite 5)
- **npm** (or another client compatible with `package-lock.json`)

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). The dev server is configured with `host: true`, so you can also open the app from another device on your LAN using your machine’s local IP and port **5173**.

| Script | Description |
| ------ | ----------- |
| `npm run dev` | Dev server (port 5173) |
| `npm run build` | Production build + typecheck |
| `npm run preview` | Preview production build |
| `npm run typecheck` | `tsc` only, no emit |

## Using the app

- **Left column:** **Town layout** (top) — switch between *Layout (staging)* and *Simulation*, place preset markers, save, and relaunch the sim. **Dialogue** (bottom) — in-world chat / TTS when enabled.
- **First-person walk:** Click the **3D view** to capture the pointer (**pointer lock**). Move with **W A S D**, hold **Shift** to move faster. Walk controls activate after the map bounds are known.
- **Layout mode:** With a marker selected, **Delete** or **Backspace** removes it (when focus is not in a text field).
- **Debug:** The **City sim** panel (top-right) shows live engine state (entities, tick, etc.).

## Optional: Ollama (NPC dialogue)

The dev server proxies **`/ollama` → `http://127.0.0.1:11434`** so the browser can call Ollama without CORS issues. Install [Ollama](https://ollama.com/), pull a model (e.g. `llama3.2`), then run `ollama serve` as usual.

For **production**, you must either expose Ollama with CORS configured, host your own API, or set `VITE_OLLAMA_BASE` to a reachable URL — the Vite proxy only applies during `npm run dev`.

Environment variables (optional, `.env` / `.env.local` — see `.gitignore`):

| Variable | Purpose |
| -------- | ------- |
| `VITE_OLLAMA_BASE` | Override API base; default is `/ollama` (proxy in dev). |
| `VITE_OLLAMA_MODEL` | Model name; default `llama3.2`. |
| `VITE_OLLAMA_ENABLED` | Set to `false` to skip Ollama and use stub dialogue only. |

## Project layout

```
AI city/
├── public/
│   └── models/
│       ├── BurgerPiz.glb
│       └── npc/
│           └── Luna.vrm
├── src/
│   ├── scene/                 # Canvas, map, lighting, ground, walk controls, night sky
│   ├── systems/citySim/       # Sim loop, entities, dialogue, town layout, LLM hooks
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css
├── vite.config.ts             # dev proxy for /ollama
├── index.html
└── package.json
```

**Town layout** is stored under the key `ai-city-town-layout-v1` in `localStorage` (see `townLayout/storage.ts`).

## Design notes

- **GLB** is the shipped map format; the viewer auto-centers the map and frames the camera from bounds.
- **Rendering:** tone-mapped output, environment lighting, contact shadows, adaptive DPR/events where configured in scene code.
- **Dialogue:** structured conversation flow can use **Web Speech** for TTS when the browser supports it; LLM path goes through the Ollama client when enabled.

## Build

```bash
npm run build
npm run preview
```

## License

Private project (`"private": true` in `package.json`). Adjust if you open-source the repo.
