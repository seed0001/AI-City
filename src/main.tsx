import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// Dev reference: town marker layout system (see TownLayoutEditorPanel in UI)
console.info(
  `%c[AI City] Town layout system`,
  "color:#a5b4fc;font-weight:bold",
  `
• Preset definitions: src/systems/citySim/data/presetMarkers.ts
• Save/load: localStorage key "ai-city-town-layout-v1" — src/systems/citySim/townLayout/storage.ts
• Relaunch validation: src/systems/citySim/townLayout/validation.ts (required homes + store)
• NPC spawn/home: CitySimManager.bootstrapFromSavedLayout() + CHARACTER_SEEDS in data/townCharacters.ts
• Add more presets: PRESET_MARKER_DEFINITIONS + optional DecisionSystem routing by type

Dialogue (structured, not one-call-per-line):
• NPC↔NPC: conversationStructured.ts — one tick = one micro-exchange (2 lines) + JSON effects; multi-tick via conversation state
• Player↔NPC: conversationPlayer.ts — one NPC reply per call
• Ollama: run \`ollama pull llama3.2\`, then \`npm run dev\` — Vite proxies /ollama → localhost:11434. Set VITE_OLLAMA_ENABLED=false to use stubs only.
`
);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
