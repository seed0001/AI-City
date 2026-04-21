import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useCitySimContext } from "../CitySimContext";
import {
  PRESET_BY_KEY,
  PRESET_MARKER_ORDER,
} from "../data/presetMarkers";
import { loadTownLayoutFromStorage, saveTownLayoutToStorage } from "./storage";
import type { PlacedMarkerRecord, SavedTownLayout, TownMode } from "./types";
import { validateLayoutForSimulation } from "./validation";

export type TownLayoutCtx = {
  mode: TownMode;
  markers: Record<string, PlacedMarkerRecord>;
  /** Key armed for next click-to-place (inventory selection). */
  armedKey: string | null;
  selectedKey: string | null;
  debugOverlay: boolean;
  setDebugOverlay: (v: boolean) => void;
  inventoryKeys: string[];
  validation: ReturnType<typeof validateLayoutForSimulation>;
  armMarker: (key: string | null) => void;
  selectMarker: (key: string | null) => void;
  placeMarkerAt: (key: string, position: { x: number; y: number; z: number }) => void;
  moveMarkerTo: (key: string, position: { x: number; y: number; z: number }) => void;
  deleteMarker: (key: string) => void;
  saveLayout: () => void;
  enterLayoutMode: () => void;
  relaunchSimulation: () => { ok: true } | { ok: false; missing: string[] };
};

const TownLayoutContext = createContext<TownLayoutCtx | null>(null);

function nextUnplacedAfter(
  markers: Record<string, PlacedMarkerRecord>,
  placedKey: string
): string | null {
  const start = PRESET_MARKER_ORDER.indexOf(placedKey);
  for (let step = 1; step <= PRESET_MARKER_ORDER.length; step++) {
    const i = (start + step) % PRESET_MARKER_ORDER.length;
    const k = PRESET_MARKER_ORDER[i];
    if (!markers[k]) return k;
  }
  return null;
}

function buildSavedLayout(
  mode: TownMode,
  markers: Record<string, PlacedMarkerRecord>
): SavedTownLayout {
  return { version: 1, mode, markers };
}

export function TownLayoutProvider({ children }: { children: ReactNode }) {
  const { manager, bump } = useCitySimContext();

  const [mode, setMode] = useState<TownMode>(() => {
    const s = loadTownLayoutFromStorage();
    if (s?.mode === "simulation" && validateLayoutForSimulation(s).ok) {
      return "simulation";
    }
    return "layout";
  });

  const [markers, setMarkers] = useState<Record<string, PlacedMarkerRecord>>(
    () => loadTownLayoutFromStorage()?.markers ?? {}
  );

  const [armedKey, setArmedKey] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [debugOverlay, setDebugOverlay] = useState(false);

  useEffect(() => {
    const s = loadTownLayoutFromStorage();
    if (s?.mode === "simulation" && validateLayoutForSimulation(s).ok) {
      manager.bootstrapFromSavedLayout(s);
      bump();
    } else {
      manager.enterLayoutMode();
      bump();
    }
  }, [manager, bump]);

  const inventoryKeys = useMemo(
    () => PRESET_MARKER_ORDER.filter((k) => !markers[k]),
    [markers]
  );

  const validation = useMemo(
    () => validateLayoutForSimulation({ version: 1, markers }),
    [markers]
  );

  const placeMarkerAt = useCallback(
    (key: string, position: { x: number; y: number; z: number }) => {
      const def = PRESET_BY_KEY[key];
      if (!def) return;
      setMarkers((prev) => {
        if (prev[key]) return prev;
        const rec: PlacedMarkerRecord = {
          key: def.key,
          label: def.label,
          type: def.type,
          assignedTo: def.assignedTo,
          required: def.required,
          position: { ...position },
          rotation: 0,
          radius: def.defaultRadius,
        };
        const next = { ...prev, [key]: rec };
        setArmedKey(nextUnplacedAfter(next, key));
        return next;
      });
    },
    []
  );

  const moveMarkerTo = useCallback(
    (key: string, position: { x: number; y: number; z: number }) => {
      setMarkers((prev) => {
        const m = prev[key];
        if (!m) return prev;
        return {
          ...prev,
          [key]: { ...m, position: { ...position } },
        };
      });
    },
    []
  );

  const deleteMarker = useCallback((key: string) => {
    setMarkers((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setSelectedKey((k) => (k === key ? null : k));
    setArmedKey((k) => (k === key ? null : k));
  }, []);

  const saveLayout = useCallback(() => {
    saveTownLayoutToStorage(buildSavedLayout("layout", markers));
  }, [markers]);

  const armMarker = useCallback((key: string | null) => {
    setArmedKey(key);
  }, []);

  const selectMarker = useCallback((key: string | null) => {
    setSelectedKey(key);
  }, []);

  const enterLayoutMode = useCallback(() => {
    manager.enterLayoutMode();
    setMode("layout");
    bump();
  }, [manager, bump]);

  const relaunchSimulation = useCallback((): { ok: true } | { ok: false; missing: string[] } => {
    const layout = buildSavedLayout("simulation", markers);
    const v = validateLayoutForSimulation(layout);
    if (!v.ok) return v;
    saveTownLayoutToStorage(layout);
    manager.bootstrapFromSavedLayout(layout);
    setMode("simulation");
    bump();
    return { ok: true };
  }, [manager, markers, bump]);

  const value = useMemo(
    () => ({
      mode,
      markers,
      armedKey,
      selectedKey,
      debugOverlay,
      setDebugOverlay,
      inventoryKeys,
      validation,
      armMarker,
      selectMarker,
      placeMarkerAt,
      moveMarkerTo,
      deleteMarker,
      saveLayout,
      enterLayoutMode,
      relaunchSimulation,
    }),
    [
      mode,
      markers,
      armedKey,
      selectedKey,
      debugOverlay,
      inventoryKeys,
      validation,
      armMarker,
      selectMarker,
      placeMarkerAt,
      moveMarkerTo,
      deleteMarker,
      saveLayout,
      enterLayoutMode,
      relaunchSimulation,
    ]
  );

  return (
    <TownLayoutContext.Provider value={value}>{children}</TownLayoutContext.Provider>
  );
}

export function useTownLayout(): TownLayoutCtx {
  const ctx = useContext(TownLayoutContext);
  if (!ctx) {
    throw new Error("useTownLayout must be used within TownLayoutProvider");
  }
  return ctx;
}
