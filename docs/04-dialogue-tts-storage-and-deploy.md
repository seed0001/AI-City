# Dialogue, TTS, storage, and deployment

This document covers **Ollama-backed dialogue**, **stub** fallbacks, **text-to-speech** (Edge in dev vs Web Speech at runtime), **user settings** (`aiSimSettings`), **browser storage** keys, and **production** considerations.

## Dialogue pipeline (LLM and stubs)

### Ollama

- **Config**: `src/systems/citySim/llm/ollamaConfig.ts` — base path, model name, enable flag from `VITE_*` env.
- **HTTP client**: `ollamaClient.ts` — `POST .../api/chat` with `stream: false`, optional **`format: "json"`** for structured dialogue.
- **Dev proxy**: In `vite.config.ts`, `server.proxy` maps **`/ollama` → `http://127.0.0.1:11434`** and strips the prefix so the browser is same-origin and **CORS-free** local.

### High-level call sites

- **`ollamaDialogue.ts`**: System prompts and **JSON** shapes for **NPC↔NPC** exchanges and **Player↔NPC** replies. User-tunable **suffixes** are merged via `withSystemSuffix()` from `settings/aiSimSettings.ts` (appended to the default system string).
- **`conversationStructured.ts`**: Scene packets (location, time bucket, `agentA` / `agentB` with merged persona fields, conversation state) → one structured exchange per tick when the LLM runs.
- **`conversationPlayer.ts`**: Player + NPC single-reply flow; merges **`getMergedAgentSlice`** for both `npc` and the **resident** (`playerResident`).

On hard failure, JSON parse error, or disabled Ollama, the code path falls back to **stub** generators in `stubDialogue.ts` / `conversationStructured` / `conversationPlayer` (short deterministic lines) so the UI and sim never depend on a live model.

## Prompt safety

- `PromptBuilder` / `WorldContextPacket` and scene packets avoid leaking **engine-only** controller metadata to the model; see comments in `types.ts`.
- `personaNotes`, traits, and merged display fields come from **user settings** + **live** entity (see `getMergedAgentSlice` in `aiSimSettings.ts`).

## Text-to-speech (TTS)

The app can speak NPC lines in two different ways, depending on environment.

### 1) Dev-only Edge TTS (Microsoft neural voices)

- **`vite-plugin-edge-tts.ts`**: A Vite middleware that exposes **POST `/api/edge-tts`**. The body is JSON `{ text, voice }`; the response is **MPEG** audio. It uses the **`edge-tts`** package (outbound to Microsoft’s speech service).
- **Not** part of a static `dist/` site — the plugin is for **`npm run dev` / `vite` preview of dev**. Production static hosting has **no** this route unless you reimplement a server.
- The plugin comment in-repo states production **falls back** to Web Speech; see `characterSpeech.ts` for the actual branch logic.

### 2) Web Speech API

- The browser’s **`SpeechSynthesis`** is used for playback when Edge is not available (or as fallback), with:
  - Global **rate / pitch / enabled** from **`aiSimSettings`**
  - Per-speaker **voice** selection: browser **voice list** and/or **stable hash** from id when in “auto”
  - **Per-NPC** `ttsVoiceId` on the entity (Edge **short name**) stored via **`ttsVoiceStorage.ts`**

### TTS and `CitySimManager.appendDialogueLine`

- Non-player lines call `speakAiLine(speakerId, text, ttsVoiceId?)` so the voice selection can use **neural** ids when the speech layer supports it.

**Catalog**: `src/systems/citySim/speech/edgeTtsVoiceCatalog.ts` — labels for **Edge** options used in life/persona strings.

## AI & voice user settings (React panel)

- **File**: `src/systems/citySim/settings/aiSimSettings.ts`
- **UI**: `AiSettingsPanel.tsx`, opened from the left HUD “**AI & voice**” tab (see `LeftHud.tsx`).

What can be changed (stored in `localStorage` under **`ai-city-sim-settings`** — see constant `STORAGE_KEY` in the module):

- Global **suffix** text for NPC↔NPC and Player↔NPC system prompts
- TTS: **on/off**, **rate**, **pitch**
- **Per character** (by entity id): display name, role, mood, trait tags, long **persona notes**, optional **browser voice** URI; **reset** one or all

These merge into LLM **scene** packets; they do not automatically retexture the 3D name tags unless you add a sync (see `README` / settings comments).

## TTS voice overrides (entity-level)

- **`saveTtsVoiceOverride` / `ttsVoiceStorage.ts`**: Persists a mapping from **entity id** to **Edge short name** (or your catalog id) for continuity across sessions. `CitySimManager.setNpcTtsVoice` updates the **live** entity and storage.

## Town layout storage

- **File**: `townLayout/storage.ts`
- **Key**: e.g. **`ai-city-town-layout-v1`** — JSON **version 1** layout of **markers** (see `types` in `townLayout`).

**Warning**: `localStorage` is **per origin**; clearing site data or using another port/domain loses or splits saved layouts and AI settings.

## Environment variables (recap)

| `VITE_*` | Use |
| -------- | --- |
| `VITE_OLLAMA_BASE` | Default `/ollama` in dev; full URL in prod if needed |
| `VITE_OLLAMA_MODEL` | e.g. `llama3.2` |
| `VITE_OLLAMA_ENABLED` | `false` to force stubs only |

Rebuild after changing Vite env vars; they are compile-time in the client bundle.

## Production deployment

1. **`npm run build`**: Output **`dist/`** – static files only.
2. **Ollama**: The dev **proxy** does not exist on a static file server. Either:
   - Put a **reverse proxy** in front of the app and Ollama under the **same origin**,
   - Or set **`VITE_OLLAMA_BASE`** to a public HTTPS API that you control (CORS or same-origin), **or** ship a small backend to proxy `/api/chat`.
3. **Edge TTS**: Do not rely on `/api/edge-tts` in production from this repo as-is; expect **Web Speech** (or your own TTS service).
4. **Security**: Never expose an unauthenticated Ollama instance to the internet. Treat the client as **untrusted**; the `VITE_` values are public.

## Quick reference: important file list (this topic)

| Topic | File |
| ----- | ---- |
| Ollama | `llm/ollamaClient.ts`, `llm/ollamaConfig.ts`, `llm/ollamaDialogue.ts` |
| NPC↔NPC packets | `conversationStructured.ts` |
| Player↔NPC | `conversationPlayer.ts` |
| Stubs | `stubDialogue.ts` |
| TTS playback / routing | `speech/characterSpeech.ts` |
| Edge TTS (dev) | `vite-plugin-edge-tts.ts`, `vite.config.ts` |
| Voice list / labels | `speech/edgeTtsVoiceCatalog.ts` |
| Persisted voice by id | `ttsVoiceStorage.ts` |
| User settings | `settings/aiSimSettings.ts`, `components/AiSettingsPanel.tsx` |
| Layout | `townLayout/storage.ts` |

## Related documentation

- **01-project-overview.md** — install, stack, env vars
- **02-3d-world-and-controls.md** — scene, HUD, walk
- **03-simulation-and-systems.md** — entities, daily plan, life arc, manager
