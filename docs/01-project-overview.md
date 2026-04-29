# Project overview

**AI City** is a browser experience that combines a **3D explorable map** (the *BurgerPiz* GLB) with a **data-driven small-town simulation**: residents move, talk, remember, form relationships, and (optionally) speak lines generated or filtered through an **LLM (Ollama)**. The UI is built in **React**; the world is rendered with **React Three Fiber** and **Three.js**; VRM avatars are loaded with **@pixiv/three-vrm**.

The repository is a **Vite** application (`npm run dev` on port **5173** by default) with a TypeScript `src/` tree. Simulation logic lives in `src/systems/citySim/`, separate from the scene in `src/scene/`, so the same engine can evolve without entangling 3D details.

## Goals and constraints

- **In-world plausibility**: LLM context is built from *perceivable* facts and resident-facing data (see `types.ts` — e.g. `controllerType` does not get sent to prompts).
- **Optional local AI**: With **Ollama** and a pulled model, dialogue can use real completions; without it, **stub** generators keep the sim alive.
- **Persistent layout**: A **town layout** (marker positions) is stored in the browser; **relaunching** the sim re-spawns NPCs and the player from that layout.
- **Readable tuning**: Durations and radii are in `constants.ts` or module-local constants, not hard-coded in dozens of places.

## Technology stack (authoritative as of the repo’s `package.json`)

| Area | Technology |
| ---- | ---------- |
| Build / dev | Vite 5, `esbuild` via Vite, TypeScript 5.6 |
| UI | React 18 |
| 3D | `three@0.169`, `@react-three/fiber@8`, `@react-three/drei@9` |
| Avatars | `@pixiv/three-vrm`, `@pixiv/three-vrm-animation` |
| TTS (dev server) | `edge-tts` (see `vite-plugin-edge-tts.ts` — not shipped as static build output) |
| Optional | `leva` in dependencies (optional debug panels) |

## Repository layout (high level)

```
public/models/     # GLB map, VRM/VRMA assets
src/scene/         # Canvas, lighting, map, walk, environment, night sky
src/systems/citySim/
  data/            # character seeds, preset markers
  llm/             # Ollama client + dialogue prompts
  townLayout/      # saved layout, 3D editor, validation
  settings/        # AI persona & prompt suffix persistence
  speech/          # TTS: Web Speech + optional Edge TTS in dev
  components/      # HUD, VRM NPCs, debug panel, sim loop
  *.ts             # managers, systems, types
App.tsx, main.tsx
vite.config.ts     # React, Edge TTS dev plugin, Ollama proxy
```

## Requirements

- **Node.js 18+** (recommended for current Vite and ESM)
- **npm** (or compatible with `package-lock.json`)
- **Ollama** (optional) — install, run, `ollama pull` your chosen model (e.g. `llama3.2`)

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). `vite.config.ts` sets `server.host: true`, so other devices on the LAN can open `http://<your-ip>:5173`.

| Script | Use |
| ------ | --- |
| `npm run dev` | Development server, HMR, Ollama proxy, Edge TTS API (dev) |
| `npm run build` | `tsc -b` + production bundle to `dist/` |
| `npm run preview` | Serve `dist/` locally |
| `npm run typecheck` | Typecheck only, no emit |

## Environment variables (Vite: `VITE_` only)

| Variable | Purpose |
| -------- | ------- |
| `VITE_OLLAMA_BASE` | Ollama API base; default `/ollama` (dev proxy to `http://127.0.0.1:11434`) |
| `VITE_OLLAMA_MODEL` | Model name, default `llama3.2` |
| `VITE_OLLAMA_ENABLED` | Set to `false` to disable Ollama and use stub dialogue only |

Types are in `src/vite-env.d.ts`. Rebuild the app after changing any `VITE_*` value (they are inlined at build time).

## Related documentation in this folder

- **02-3d-world-and-controls.md** — Scene graph, first-person walk, VRM, rendering choices.
- **03-simulation-and-systems.md** — Entities, daily plans, life arc, decisions, layout bootstrap.
- **04-dialogue-tts-storage-and-deploy.md** — Ollama flow, TTS (Edge dev vs Web Speech), settings, `localStorage`, production notes.
- **05-entity-system-and-agent-brains.md** — How AI resident brains are wired: persona, memory layers, decisions, and conversation feedback loops.
- **06-lan-shared-world-mobile-client.md** — Host-authoritative LAN mode, websocket protocol, and mobile thin client runbook.

## License and provenance

`package.json` marks the project as **private** — treat assets (map, VRM) according to your own rights and the upstream licenses of **Three.js**, **React**, **Ollama** models, and **edge-tts** (Microsoft’s online speech endpoint, used in dev by the Vite plugin).
