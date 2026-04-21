import { PRESET_MARKER_DEFINITIONS, REQUIRED_MARKER_KEYS } from "../data/presetMarkers";
import type { SavedTownLayout } from "./types";

export type ValidationResult =
  | { ok: true }
  | { ok: false; missing: string[] };

export function validateLayoutForSimulation(
  layout: SavedTownLayout
): ValidationResult {
  const missing: string[] = [];
  for (const key of REQUIRED_MARKER_KEYS) {
    if (!layout.markers[key]) {
      const def = PRESET_MARKER_DEFINITIONS.find((d) => d.key === key);
      missing.push(def?.label ?? key);
    }
  }
  if (missing.length) return { ok: false, missing };
  return { ok: true };
}
