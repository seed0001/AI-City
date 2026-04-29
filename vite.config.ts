import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { edgeTtsPlugin } from "./vite-plugin-edge-tts";
import { lanHubPlugin } from "./vite-plugin-lan-hub";

export default defineConfig({
  plugins: [react(), edgeTtsPlugin(), lanHubPlugin()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      // Browser → Vite → Ollama (avoids CORS; Ollama listens on 11434)
      "/ollama": {
        target: "http://127.0.0.1:11434",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ollama/, ""),
      },
    },
  },
  build: {
    target: "es2022",
    sourcemap: true,
    assetsInlineLimit: 0,
  },
  assetsInclude: ["**/*.glb", "**/*.gltf", "**/*.hdr", "**/*.exr"],
});
