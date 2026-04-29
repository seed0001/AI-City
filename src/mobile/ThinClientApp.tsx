import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, Preload } from "@react-three/drei";
import {
  ACESFilmicToneMapping,
  CapsuleGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SRGBColorSpace,
  Vector3,
} from "three";
import BurgerPizModel from "../scene/BurgerPizModel";
import Lighting from "../scene/Lighting";
import Ground from "../scene/Ground";
import EnvironmentLayer from "../scene/EnvironmentLayer";
import NightSky from "../scene/NightSky";
import type {
  HostWorldSnapshot,
  HubServerToClient,
  NetworkEntitySnapshot,
} from "../systems/citySim/network/protocol";
import { lanHubSocketUrl } from "../systems/citySim/network/socketUrl";

const NETWORK_PLAYER_ID_PREFIX = "resident_net_";
const CAMERA_EYE_HEIGHT = 1.72;
const MOVE_SPEED = 4.2;
const SPRINT_MULT = 1.7;
const SEND_POSE_MS = 90;
const PING_MS = 12000;

type MoveState = {
  x: number;
  z: number;
  sprint: boolean;
};

type LookDelta = {
  dx: number;
  dy: number;
};

const geom = new CapsuleGeometry(0.3, 1.05, 6, 12);
const matAi = new MeshStandardMaterial({ color: "#a78bfa" });
const matHuman = new MeshStandardMaterial({ color: "#38bdf8" });

function useQueryParam(name: string): string {
  return new URLSearchParams(window.location.search).get(name) ?? "";
}

function readDisplayName(): string {
  const key = "ai-city-lan-display-name";
  const existing = localStorage.getItem(key)?.trim();
  if (existing) return existing;
  const generated = `Guest-${Math.random().toString(36).slice(2, 6)}`;
  localStorage.setItem(key, generated);
  return generated;
}

function RemoteEntityVisual({ entity }: { entity: NetworkEntitySnapshot }) {
  const group = useRef<Group>(null);
  const mesh = useRef<Mesh>(null);

  useFrame(() => {
    if (!group.current || !mesh.current) return;
    group.current.position.set(entity.position.x, entity.position.y, entity.position.z);
    mesh.current.rotation.y = entity.rotation;
  });

  return (
    <group ref={group}>
      <mesh
        ref={mesh}
        castShadow
        geometry={geom}
        material={entity.controlledBy === "ai" ? matAi : matHuman}
        position={[0, -0.55, 0]}
      />
      <Html position={[0, 1.15, 0]} center distanceFactor={8}>
        <div
          style={{
            pointerEvents: "none",
            color: "#f1f5f9",
            fontSize: 10,
            textShadow: "0 1px 4px #000",
            whiteSpace: "nowrap",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          {entity.displayName}
        </div>
      </Html>
    </group>
  );
}

function CameraRig({
  moveRef,
  lookRef,
  localEntity,
  onPose,
}: {
  moveRef: MutableRefObject<MoveState>;
  lookRef: MutableRefObject<LookDelta>;
  localEntity: NetworkEntitySnapshot | undefined;
  onPose: (p: { x: number; y: number; z: number; rotationY: number; moveX: number; moveZ: number; sprint: boolean }) => void;
}) {
  const { camera } = useThree();
  const yawRef = useRef(0);
  const pitchRef = useRef(0);
  const initializedRef = useRef(false);
  const sendAcc = useRef(0);

  useEffect(() => {
    if (!localEntity || initializedRef.current) return;
    camera.position.set(localEntity.position.x, CAMERA_EYE_HEIGHT, localEntity.position.z);
    yawRef.current = localEntity.rotation;
    pitchRef.current = 0;
    initializedRef.current = true;
  }, [camera, localEntity]);

  useFrame((_, delta) => {
    const look = lookRef.current;
    yawRef.current -= look.dx * 0.003;
    pitchRef.current = Math.max(-1.1, Math.min(1.1, pitchRef.current - look.dy * 0.0025));
    look.dx *= 0.65;
    look.dy *= 0.65;

    const move = moveRef.current;
    const forward = new Vector3(Math.sin(yawRef.current), 0, Math.cos(yawRef.current) * -1);
    const right = new Vector3(forward.z * -1, 0, forward.x);
    const speed = MOVE_SPEED * (move.sprint ? SPRINT_MULT : 1);
    const step = new Vector3()
      .addScaledVector(forward, move.z)
      .addScaledVector(right, move.x);
    if (step.lengthSq() > 0) {
      step.normalize().multiplyScalar(speed * delta);
      camera.position.add(step);
    }
    camera.position.y = CAMERA_EYE_HEIGHT;
    camera.rotation.order = "YXZ";
    camera.rotation.y = yawRef.current;
    camera.rotation.x = pitchRef.current;
    camera.rotation.z = 0;

    sendAcc.current += delta * 1000;
    if (sendAcc.current >= SEND_POSE_MS) {
      sendAcc.current = 0;
      onPose({
        x: camera.position.x,
        y: camera.position.y,
        z: camera.position.z,
        rotationY: yawRef.current,
        moveX: move.x,
        moveZ: move.z,
        sprint: move.sprint,
      });
    }
  });

  return null;
}

function ThinScene({
  snapshot,
  localEntityId,
  moveRef,
  lookRef,
  onPose,
  lowPower,
}: {
  snapshot: HostWorldSnapshot | null;
  localEntityId: string | null;
  moveRef: MutableRefObject<MoveState>;
  lookRef: MutableRefObject<LookDelta>;
  onPose: (p: { x: number; y: number; z: number; rotationY: number; moveX: number; moveZ: number; sprint: boolean }) => void;
  lowPower: boolean;
}) {
  const entities = snapshot?.entities ?? [];
  const localEntity = localEntityId ? entities.find((e) => e.id === localEntityId) : undefined;
  const remotes = useMemo(
    () => entities.filter((e) => e.id !== localEntityId),
    [entities, localEntityId]
  );

  return (
    <Canvas
      className="city-scene-canvas-wrap"
      shadows
      dpr={lowPower ? [0.6, 0.9] : [0.8, 1.25]}
      gl={{
        antialias: !lowPower,
        powerPreference: "high-performance",
        toneMapping: ACESFilmicToneMapping,
        outputColorSpace: SRGBColorSpace,
      }}
      camera={{ fov: 50, near: 0.05, far: 250000, position: [0, CAMERA_EYE_HEIGHT, 12] }}
    >
      <NightSky />
      <Lighting />
      <BurgerPizModel url="/models/BurgerPiz.glb" />
      {lowPower ? null : <EnvironmentLayer preset="night" />}
      <Ground />
      <CameraRig moveRef={moveRef} lookRef={lookRef} localEntity={localEntity} onPose={onPose} />
      {remotes.map((e) => (
        <RemoteEntityVisual key={e.id} entity={e} />
      ))}
      <Preload all />
    </Canvas>
  );
}

function TouchJoystick({
  moveRef,
}: {
  moveRef: MutableRefObject<MoveState>;
}) {
  const areaRef = useRef<HTMLDivElement>(null);
  const pointerIdRef = useRef<number | null>(null);
  const centerRef = useRef({ x: 0, y: 0 });
  const knobPosRef = useRef({ x: 0, y: 0 });
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const MAX = 46;

  const reset = () => {
    pointerIdRef.current = null;
    knobPosRef.current = { x: 0, y: 0 };
    moveRef.current.x = 0;
    moveRef.current.z = 0;
    setKnob({ x: 0, y: 0 });
  };

  return (
    <div
      ref={areaRef}
      onPointerDown={(e) => {
        pointerIdRef.current = e.pointerId;
        const r = areaRef.current?.getBoundingClientRect();
        if (r) centerRef.current = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }}
      onPointerMove={(e) => {
        if (pointerIdRef.current !== e.pointerId) return;
        const dx = e.clientX - centerRef.current.x;
        const dy = e.clientY - centerRef.current.y;
        const len = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        const k = len > MAX ? MAX / len : 1;
        const nx = dx * k;
        const ny = dy * k;
        knobPosRef.current = { x: nx, y: ny };
        setKnob({ x: nx, y: ny });
        moveRef.current.x = nx / MAX;
        moveRef.current.z = -ny / MAX;
      }}
      onPointerUp={reset}
      onPointerCancel={reset}
      style={{
        width: 122,
        height: 122,
        borderRadius: "50%",
        border: "1px solid rgba(255,255,255,0.25)",
        background: "rgba(10,12,20,0.45)",
        position: "relative",
        touchAction: "none",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: 52,
          height: 52,
          borderRadius: "50%",
          transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))`,
          border: "1px solid rgba(255,255,255,0.4)",
          background: "rgba(125,211,252,0.28)",
        }}
      />
    </div>
  );
}

export default function ThinClientApp() {
  const host = useQueryParam("host");
  const quality = useQueryParam("quality");
  const lowPower = quality === "low";
  const [snapshot, setSnapshot] = useState<HostWorldSnapshot | null>(null);
  const [hostOnline, setHostOnline] = useState(false);
  const [connected, setConnected] = useState(false);
  const [chatDraft, setChatDraft] = useState("");
  const [displayName] = useState(() => readDisplayName());
  const [clientId, setClientId] = useState<string | null>(null);
  const [retrySeq, setRetrySeq] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const moveRef = useRef<MoveState>({ x: 0, z: 0, sprint: false });
  const lookRef = useRef<LookDelta>({ dx: 0, dy: 0 });
  const lookPointerRef = useRef<number | null>(null);
  const lastLookPointRef = useRef<{ x: number; y: number } | null>(null);

  const sendJson = useCallback((payload: unknown) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== ws.OPEN) return;
    ws.send(JSON.stringify(payload));
  }, []);

  useEffect(() => {
    let reconnectTimer: number | null = null;
    const ws = new WebSocket(lanHubSocketUrl(host));
    wsRef.current = ws;

    ws.addEventListener("open", () => {
      setConnected(true);
      sendJson({
        type: "register",
        role: "client",
        displayName,
      });
    });

    ws.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;
      let msg: HubServerToClient | null = null;
      try {
        msg = JSON.parse(event.data) as HubServerToClient;
      } catch {
        msg = null;
      }
      if (!msg) return;
      if (msg.type === "welcome") {
        setClientId(msg.clientId === "pending" ? null : msg.clientId);
        setHostOnline(msg.hostOnline);
      } else if (msg.type === "hostStatus") {
        setHostOnline(msg.online);
      } else if (msg.type === "hostToClientSnapshot") {
        setSnapshot(msg.snapshot);
      }
    });

    const scheduleReconnect = () => {
      if (reconnectTimer != null) return;
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        setRetrySeq((n) => n + 1);
      }, 1200);
    };
    ws.addEventListener("close", () => {
      setConnected(false);
      scheduleReconnect();
    });
    ws.addEventListener("error", () => {
      setConnected(false);
      scheduleReconnect();
    });

    const pingTimer = window.setInterval(() => {
      sendJson({ type: "ping", at: Date.now() });
    }, PING_MS);

    return () => {
      window.clearInterval(pingTimer);
      if (reconnectTimer != null) window.clearTimeout(reconnectTimer);
      try {
        ws.close();
      } catch {
        /* noop */
      }
    };
  }, [displayName, host, retrySeq, sendJson]);

  const onPose = useCallback(
    (p: { x: number; y: number; z: number; rotationY: number; moveX: number; moveZ: number; sprint: boolean }) => {
      sendJson({
        type: "clientPose",
        position: { x: p.x, y: p.y, z: p.z },
        rotationY: p.rotationY,
        moveX: p.moveX,
        moveZ: p.moveZ,
        sprint: p.sprint,
      });
    },
    [sendJson]
  );

  const submitChat = () => {
    const text = chatDraft.trim();
    if (!text) return;
    sendJson({ type: "clientChat", text });
    setChatDraft("");
  };

  const localEntityId = clientId ? `${NETWORK_PLAYER_ID_PREFIX}${clientId}` : null;

  return (
    <div style={{ position: "fixed", inset: 0, background: "#05050a", overflow: "hidden" }}>
      <ThinScene
        snapshot={snapshot}
        localEntityId={localEntityId}
        moveRef={moveRef}
        lookRef={lookRef}
        onPose={onPose}
        lowPower={lowPower}
      />

      <div
        style={{
          position: "fixed",
          top: "max(8px, env(safe-area-inset-top))",
          left: "max(8px, env(safe-area-inset-left))",
          right: "max(8px, env(safe-area-inset-right))",
          zIndex: 50,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
          background: "rgba(8,10,18,0.65)",
          border: "1px solid rgba(255,255,255,0.15)",
          borderRadius: 12,
          padding: "8px 10px",
          fontSize: 12,
          color: "#e2e8f0",
          backdropFilter: "blur(6px)",
        }}
      >
        <span>{displayName}</span>
        <span style={{ color: connected && hostOnline ? "#86efac" : "#fca5a5" }}>
          {connected ? (hostOnline ? "host online" : "waiting for host") : "offline"}
        </span>
      </div>

      <div
        onPointerDown={(e) => {
          lookPointerRef.current = e.pointerId;
          lastLookPointRef.current = { x: e.clientX, y: e.clientY };
        }}
        onPointerMove={(e) => {
          if (lookPointerRef.current !== e.pointerId) return;
          if (!lastLookPointRef.current) {
            lastLookPointRef.current = { x: e.clientX, y: e.clientY };
            return;
          }
          const dx = e.clientX - lastLookPointRef.current.x;
          const dy = e.clientY - lastLookPointRef.current.y;
          lookRef.current.dx += dx;
          lookRef.current.dy += dy;
          lastLookPointRef.current = { x: e.clientX, y: e.clientY };
        }}
        onPointerUp={(e) => {
          if (lookPointerRef.current !== e.pointerId) return;
          lookPointerRef.current = null;
          lastLookPointRef.current = null;
        }}
        onPointerCancel={() => {
          lookPointerRef.current = null;
          lastLookPointRef.current = null;
        }}
        style={{
          position: "fixed",
          right: "max(8px, env(safe-area-inset-right))",
          bottom: "max(190px, calc(env(safe-area-inset-bottom) + 180px))",
          width: "48vw",
          maxWidth: 260,
          height: 160,
          borderRadius: 14,
          border: "1px solid rgba(255,255,255,0.18)",
          background: "rgba(8,10,18,0.3)",
          zIndex: 40,
          touchAction: "none",
        }}
      />

      <div
        style={{
          position: "fixed",
          left: "max(10px, env(safe-area-inset-left))",
          bottom: "max(190px, calc(env(safe-area-inset-bottom) + 175px))",
          zIndex: 41,
          display: "flex",
          flexDirection: "column",
          gap: 10,
          alignItems: "center",
        }}
      >
        <TouchJoystick moveRef={moveRef} />
        <button
          type="button"
          onPointerDown={() => {
            moveRef.current.sprint = true;
          }}
          onPointerUp={() => {
            moveRef.current.sprint = false;
          }}
          onPointerCancel={() => {
            moveRef.current.sprint = false;
          }}
          style={{
            width: 84,
            height: 38,
            borderRadius: 999,
            border: "1px solid rgba(255,255,255,0.28)",
            background: "rgba(20,28,48,0.6)",
            color: "#f8fafc",
            fontSize: 12,
          }}
        >
          Sprint
        </button>
      </div>

      <div
        style={{
          position: "fixed",
          left: "max(8px, env(safe-area-inset-left))",
          right: "max(8px, env(safe-area-inset-right))",
          bottom: "max(8px, env(safe-area-inset-bottom))",
          height: 176,
          zIndex: 60,
          borderRadius: 14,
          border: "1px solid rgba(255,255,255,0.16)",
          background: "rgba(6,8,14,0.86)",
          backdropFilter: "blur(6px)",
          padding: 8,
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        <div style={{ flex: 1, overflowY: "auto", fontSize: 12, color: "#e5e7eb" }}>
          {(snapshot?.dialogueTail ?? []).map((line) => (
            <div key={line.id} style={{ marginBottom: 6 }}>
              <span style={{ color: "#c4b5fd", fontWeight: 600 }}>{line.speakerName}: </span>
              <span>{line.text}</span>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <input
            type="text"
            value={chatDraft}
            onChange={(e) => setChatDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitChat();
            }}
            placeholder="Chat with nearby NPCs..."
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 14,
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.16)",
              background: "rgba(0,0,0,0.35)",
              color: "#f8fafc",
              padding: "10px 12px",
            }}
          />
          <button
            type="button"
            onClick={submitChat}
            style={{
              borderRadius: 10,
              border: "1px solid rgba(134,239,172,0.4)",
              background: "rgba(22,163,74,0.25)",
              color: "#dcfce7",
              padding: "0 14px",
              fontSize: 14,
              minWidth: 66,
            }}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

