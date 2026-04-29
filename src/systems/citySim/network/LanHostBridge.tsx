import { useEffect, useMemo, useRef } from "react";
import { useCitySimContext } from "../CitySimContext";
import type {
  HostWorldSnapshot,
  HubServerToClient,
  NetworkEntitySnapshot,
} from "./protocol";
import { lanHubSocketUrl } from "./socketUrl";

const SNAPSHOT_INTERVAL_MS = 100;
const PING_INTERVAL_MS = 12000;
const MAX_CHAT_CHARS = 280;
const WORLD_LIMIT = 5000;

function finite(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function asEntitySnapshot(entity: {
  id: string;
  displayName: string;
  role: string;
  mood: string;
  position: { x: number; y: number; z: number };
  rotation: number;
  currentAction: string;
  controlledBy: "ai" | "human" | "network";
}): NetworkEntitySnapshot {
  return {
    id: entity.id,
    displayName: entity.displayName,
    role: entity.role,
    mood: entity.mood,
    position: { ...entity.position },
    rotation: entity.rotation,
    currentAction: entity.currentAction,
    controlledBy: entity.controlledBy,
  };
}

export default function LanHostBridge() {
  const { manager } = useCitySimContext();
  const wsRef = useRef<WebSocket | null>(null);
  const closedRef = useRef(false);
  const lastClientNamesRef = useRef<Map<string, string>>(new Map());
  const hostDisplayName = useMemo(() => "Host", []);

  useEffect(() => {
    closedRef.current = false;
    const ws = new WebSocket(lanHubSocketUrl());
    wsRef.current = ws;

    const send = (payload: unknown): void => {
      if (ws.readyState !== ws.OPEN) return;
      ws.send(JSON.stringify(payload));
    };

    ws.addEventListener("open", () => {
      send({
        type: "register",
        role: "host",
        displayName: hostDisplayName,
      });
    });

    ws.addEventListener("message", (event) => {
      const raw = event.data;
      if (typeof raw !== "string") return;
      let msg: HubServerToClient | null = null;
      try {
        msg = JSON.parse(raw) as HubServerToClient;
      } catch {
        msg = null;
      }
      if (!msg) return;

      switch (msg.type) {
        case "clientJoined": {
          const existingName = lastClientNamesRef.current.get(msg.clientId);
          const name = msg.displayName?.trim() || existingName || "Guest";
          lastClientNamesRef.current.set(msg.clientId, name);
          manager.upsertNetworkPlayer(msg.clientId, name);
          break;
        }
        case "clientLeft":
          lastClientNamesRef.current.delete(msg.clientId);
          manager.removeNetworkPlayer(msg.clientId);
          break;
        case "clientToHostPose": {
          manager.upsertNetworkPlayer(
            msg.clientId,
            lastClientNamesRef.current.get(msg.clientId) ?? "Guest"
          );
          const px = clamp(finite(msg.position?.x, 0), -WORLD_LIMIT, WORLD_LIMIT);
          const py = clamp(finite(msg.position?.y, 1.72), 0, 30);
          const pz = clamp(finite(msg.position?.z, 0), -WORLD_LIMIT, WORLD_LIMIT);
          const rot = finite(msg.rotationY, 0);
          manager.applyNetworkPlayerPose(msg.clientId, {
            position: { x: px, y: py, z: pz },
            rotationY: rot,
          });
          break;
        }
        case "clientToHostChat": {
          const text = String(msg.text ?? "").trim().slice(0, MAX_CHAT_CHARS);
          if (!text) break;
          const playerId = manager.getNetworkEntityId(msg.clientId);
          void manager.submitPlayerChat(playerId, text);
          break;
        }
        default:
          break;
      }
    });

    const snapshotTimer = window.setInterval(() => {
      if (ws.readyState !== ws.OPEN) return;
      const snap = manager.snapshot();
      const payload: HostWorldSnapshot = {
        tick: snap.tick,
        entities: snap.entities.map(asEntitySnapshot),
        dialogueTail: manager.dialogueLog.slice(-60),
      };
      send({
        type: "hostSnapshot",
        snapshot: payload,
      });
    }, SNAPSHOT_INTERVAL_MS);

    const pingTimer = window.setInterval(() => {
      send({ type: "ping", at: Date.now() });
    }, PING_INTERVAL_MS);

    const cleanup = () => {
      if (closedRef.current) return;
      closedRef.current = true;
      window.clearInterval(snapshotTimer);
      window.clearInterval(pingTimer);
      try {
        ws.close();
      } catch {
        /* noop */
      }
      wsRef.current = null;
    };

    ws.addEventListener("close", cleanup);
    ws.addEventListener("error", cleanup);

    return cleanup;
  }, [hostDisplayName, manager]);

  return null;
}

