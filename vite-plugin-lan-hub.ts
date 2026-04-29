import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import type { Plugin } from "vite";
import { WebSocketServer, type WebSocket } from "ws";

const HUB_PATH = "/lan";
const HEARTBEAT_MS = 15000;
const CLIENT_TIMEOUT_MS = 45000;

type HubRole = "unknown" | "host" | "client";
type HubSocket = WebSocket & {
  _hubClientId?: string;
  _hubRole?: HubRole;
  _hubLastSeenAt?: number;
  _hubDisplayName?: string;
};

type HubClientState = {
  id: string;
  socket: HubSocket;
  role: HubRole;
  displayName: string;
  lastSeenAt: number;
};

type InboundMessage = Record<string, unknown> & { type?: unknown };

function nextId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function safeSend(socket: HubSocket, payload: unknown): void {
  if (socket.readyState !== socket.OPEN) return;
  try {
    socket.send(JSON.stringify(payload));
  } catch {
    /* ignore transient send failure */
  }
}

function parseJson(raw: unknown): InboundMessage | null {
  if (typeof raw !== "string") return null;
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === "object" ? (value as InboundMessage) : null;
  } catch {
    return null;
  }
}

export function lanHubPlugin(): Plugin {
  return {
    name: "lan-hub",
    configureServer(server) {
      const wss = new WebSocketServer({ noServer: true });
      const clients = new Map<string, HubClientState>();
      let hostClientId: string | null = null;
      let lastHostSnapshot: unknown = null;

      const getClient = (id: string | null): HubClientState | undefined =>
        id ? clients.get(id) : undefined;

      const broadcastToRole = (role: HubRole, payload: unknown): void => {
        for (const c of clients.values()) {
          if (c.role === role) safeSend(c.socket, payload);
        }
      };

      const notifyHostStatus = (): void => {
        broadcastToRole("client", {
          type: "hostStatus",
          online: Boolean(hostClientId && getClient(hostClientId)),
        });
      };

      const removeClient = (id: string): void => {
        const c = clients.get(id);
        if (!c) return;
        clients.delete(id);
        if (id === hostClientId) {
          hostClientId = null;
          lastHostSnapshot = null;
          notifyHostStatus();
        } else {
          const host = getClient(hostClientId);
          if (host) safeSend(host.socket, { type: "clientLeft", clientId: id });
        }
      };

      const registerClient = (
        socket: HubSocket,
        role: HubRole,
        displayName: string
      ): HubClientState => {
        const id = nextId(role === "host" ? "host" : "client");
        const state: HubClientState = {
          id,
          socket,
          role,
          displayName,
          lastSeenAt: Date.now(),
        };
        clients.set(id, state);
        socket._hubClientId = id;
        socket._hubRole = role;
        socket._hubDisplayName = displayName;
        socket._hubLastSeenAt = state.lastSeenAt;
        return state;
      };

      const upgradeListener = (
        req: IncomingMessage,
        socket: Socket,
        head: Buffer
      ): void => {
        const url = req.url ?? "";
        if (!url.startsWith(HUB_PATH)) return;
        wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
          wss.emit("connection", ws, req);
        });
      };

      server.httpServer?.on("upgrade", upgradeListener);

      wss.on("connection", (ws: WebSocket) => {
        const socket = ws as HubSocket;
        socket._hubRole = "unknown";
        socket._hubLastSeenAt = Date.now();

        safeSend(socket, {
          type: "welcome",
          clientId: "pending",
          hostOnline: Boolean(hostClientId && getClient(hostClientId)),
        });

        socket.on("message", (chunk: WebSocket.RawData) => {
          const msg = parseJson(chunk.toString());
          if (!msg || typeof msg.type !== "string") {
            safeSend(socket, { type: "error", message: "invalid message payload" });
            return;
          }
          socket._hubLastSeenAt = Date.now();
          const currentId = socket._hubClientId;
          const currentRole = socket._hubRole ?? "unknown";

          if (msg.type === "register") {
            if (currentId) return;
            const role = msg.role === "host" ? "host" : msg.role === "client" ? "client" : null;
            if (!role) {
              safeSend(socket, { type: "error", message: "invalid role" });
              return;
            }
            const displayName =
              typeof msg.displayName === "string" && msg.displayName.trim()
                ? msg.displayName.trim().slice(0, 32)
                : role === "host"
                  ? "Host"
                  : "Guest";
            const state = registerClient(socket, role, displayName);
            if (role === "host") {
              hostClientId = state.id;
              safeSend(socket, {
                type: "welcome",
                clientId: state.id,
                hostOnline: true,
              });
              notifyHostStatus();
              for (const c of clients.values()) {
                if (c.id === state.id || c.role !== "client") continue;
                safeSend(socket, {
                  type: "clientJoined",
                  clientId: c.id,
                  displayName: c.displayName,
                });
              }
            } else {
              safeSend(socket, {
                type: "welcome",
                clientId: state.id,
                hostOnline: Boolean(hostClientId && getClient(hostClientId)),
              });
              const host = getClient(hostClientId);
              if (host) {
                safeSend(host.socket, {
                  type: "clientJoined",
                  clientId: state.id,
                  displayName: state.displayName,
                });
                if (lastHostSnapshot) {
                  safeSend(socket, {
                    type: "hostToClientSnapshot",
                    snapshot: lastHostSnapshot,
                  });
                }
              }
            }
            return;
          }

          if (!currentId) {
            safeSend(socket, { type: "error", message: "register first" });
            return;
          }

          const state = clients.get(currentId);
          if (!state) return;
          state.lastSeenAt = Date.now();

          if (msg.type === "ping") return;

          if (msg.type === "hostSnapshot") {
            if (currentRole !== "host") return;
            if (!("snapshot" in msg)) return;
            lastHostSnapshot = msg.snapshot;
            broadcastToRole("client", {
              type: "hostToClientSnapshot",
              snapshot: msg.snapshot,
            });
            return;
          }

          if (msg.type === "clientPose") {
            if (currentRole !== "client") return;
            const host = getClient(hostClientId);
            if (!host) return;
            safeSend(host.socket, {
              type: "clientToHostPose",
              clientId: currentId,
              position: msg.position,
              rotationY: msg.rotationY,
              moveX: msg.moveX,
              moveZ: msg.moveZ,
              sprint: msg.sprint,
            });
            return;
          }

          if (msg.type === "clientChat") {
            if (currentRole !== "client") return;
            const host = getClient(hostClientId);
            if (!host) return;
            safeSend(host.socket, {
              type: "clientToHostChat",
              clientId: currentId,
              text: msg.text,
            });
            return;
          }
        });

        socket.on("close", () => {
          if (!socket._hubClientId) return;
          removeClient(socket._hubClientId);
        });
      });

      const timer = setInterval(() => {
        const now = Date.now();
        for (const c of clients.values()) {
          if (now - c.lastSeenAt <= CLIENT_TIMEOUT_MS) continue;
          try {
            c.socket.close();
          } catch {
            /* noop */
          }
          removeClient(c.id);
        }
      }, HEARTBEAT_MS);

      return () => {
        clearInterval(timer);
        wss.close();
        server.httpServer?.off("upgrade", upgradeListener);
      };
    },
  };
}

