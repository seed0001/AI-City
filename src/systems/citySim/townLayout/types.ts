import type { PresetMarkerType } from "../data/presetMarkers";

export type TownMode = "layout" | "simulation";

/** One placed instance in the world (matches suggested save shape). */
export interface PlacedMarkerRecord {
  key: string;
  label: string;
  type: PresetMarkerType;
  assignedTo?: string;
  required: boolean;
  position: { x: number; y: number; z: number };
  rotation: number;
  radius: number;
}

export interface SavedTownLayout {
  version: 1;
  /** Last mode when saved (optional for older saves). */
  mode?: TownMode;
  markers: Record<string, PlacedMarkerRecord>;
}
