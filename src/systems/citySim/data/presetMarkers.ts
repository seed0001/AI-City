/**
 * Unique preset town markers (one instance each). Keys are stable IDs used in save files and sim.
 * To add more markers: append here and wire any special behavior in DecisionSystem if needed.
 */

export type PresetMarkerType =
  | "home"
  | "store"
  | "park"
  | "social";

export type PresetMarkerDef = {
  key: string;
  label: string;
  type: PresetMarkerType;
  /** NPC id (e.g. bob) for home markers */
  assignedTo?: string;
  required: boolean;
  defaultRadius: number;
};

export const PRESET_MARKER_DEFINITIONS: PresetMarkerDef[] = [
  {
    key: "home_bob",
    label: "Bob's House",
    type: "home",
    assignedTo: "bob",
    required: true,
    defaultRadius: 10,
  },
  {
    key: "home_sarah",
    label: "Sarah's House",
    type: "home",
    assignedTo: "sarah",
    required: true,
    defaultRadius: 10,
  },
  {
    key: "home_luna",
    label: "Luna's House",
    type: "home",
    assignedTo: "luna",
    required: true,
    defaultRadius: 10,
  },
  {
    key: "home_adam",
    label: "Adam's House",
    type: "home",
    assignedTo: "adam",
    required: true,
    defaultRadius: 10,
  },
  {
    key: "store_main",
    label: "Store",
    type: "store",
    required: true,
    defaultRadius: 12,
  },
  {
    key: "park_main",
    label: "Park",
    type: "park",
    required: false,
    defaultRadius: 14,
  },
  {
    key: "square_main",
    label: "Town Square",
    type: "social",
    required: false,
    defaultRadius: 16,
  },
];

export const PRESET_MARKER_ORDER = PRESET_MARKER_DEFINITIONS.map((d) => d.key);

export const PRESET_BY_KEY = Object.fromEntries(
  PRESET_MARKER_DEFINITIONS.map((d) => [d.key, d])
) as Record<string, PresetMarkerDef>;

export const REQUIRED_MARKER_KEYS = PRESET_MARKER_DEFINITIONS.filter(
  (d) => d.required
).map((d) => d.key);
