/**
 * Dev / preview only: POST /api/edge-tts → MP3 from Microsoft Edge online TTS (edge-tts).
 * Uses the `edge-tts` npm package (WebSocket to speech.platform.bing.com).
 * Not included in `vite build` static output — production falls back to Web Speech API.
 */
import type { Connect, Plugin } from "vite";

const MAX_CHARS = 2800;
const ROUTE = "/api/edge-tts";

function attachMiddleware(middlewares: Connect.Server): void {
  middlewares.use((req: any, res: any, next: () => void) => {
    if (req.url !== ROUTE || req.method !== "POST") {
      return next();
    }

    const chunks: Uint8Array[] = [];
    req.on("data", (c: Uint8Array) => {
      chunks.push(c);
    });
    req.on("end", () => {
      void (async () => {
        try {
          let total = 0;
          for (const c of chunks) total += c.length;
          const u8 = new Uint8Array(total);
          let off = 0;
          for (const c of chunks) {
            u8.set(c, off);
            off += c.length;
          }
          const json = new TextDecoder().decode(u8) as string;
          const raw = JSON.parse(json) as { text?: string; voice?: string };
          const text = String(raw.text ?? "")
            .trim()
            .slice(0, MAX_CHARS);
          if (!text) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "text/plain; charset=utf-8");
            res.end("empty text");
            return;
          }
          const { tts } = await import("edge-tts");
          const buf = await tts(text, {
            voice: raw.voice ?? "en-US-AvaNeural",
          });
          res.statusCode = 200;
          res.setHeader("Content-Type", "audio/mpeg");
          res.setHeader("Cache-Control", "no-store");
          res.end(buf);
        } catch (e) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.end(e instanceof Error ? e.message : "edge tts error");
        }
      })();
    });
  });
}

export function edgeTtsPlugin(): Plugin {
  return {
    name: "edge-tts-api",
    configureServer(server) {
      attachMiddleware(server.middlewares);
    },
    configurePreviewServer(server) {
      attachMiddleware(server.middlewares);
    },
  };
}
