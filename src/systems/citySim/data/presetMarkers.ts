/**
 * Unique preset town markers (one instance each). Keys are stable IDs used in save files and sim.
 * `business_spot` markers are interior/service choreography points — not added to general `CityLocation` navigation.
 */

export type PresetMarkerType =
  | "home"
  | "store"
  | "park"
  | "social"
  | "business_root"
  | "business_spot";

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
  // --- Original homes & town POIs (required flags unchanged for backward compatibility) ---
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
    key: "home_maya",
    label: "Maya's Place",
    type: "home",
    assignedTo: "maya",
    required: false,
    defaultRadius: 10,
  },
  {
    key: "home_river",
    label: "Riverside Unit",
    type: "home",
    assignedTo: "river",
    required: false,
    defaultRadius: 10,
  },
  {
    key: "home_tina",
    label: "Tina's House",
    type: "home",
    assignedTo: "tina",
    required: false,
    defaultRadius: 10,
  },
  {
    key: "home_omar",
    label: "Omar's House",
    type: "home",
    assignedTo: "omar",
    required: false,
    defaultRadius: 10,
  },
  {
    key: "home_mina",
    label: "Mina's Apartment",
    type: "home",
    assignedTo: "mina",
    required: false,
    defaultRadius: 10,
  },
  {
    key: "home_chris",
    label: "Chris's House",
    type: "home",
    assignedTo: "chris",
    required: false,
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
  // --- Burger joint (place near the map’s restaurant area; all optional for global relaunch) ---
  {
    key: "burger_joint_root",
    label: "Burger joint (root)",
    type: "business_root",
    required: false,
    defaultRadius: 14,
  },
  {
    key: "burger_customer_order_spot",
    label: "Burger · order point",
    type: "business_spot",
    required: false,
    defaultRadius: 2,
  },
  {
    key: "burger_worker_counter_spot",
    label: "Burger · counter (worker)",
    type: "business_spot",
    required: false,
    defaultRadius: 2,
  },
  {
    key: "burger_kitchen_prep_spot",
    label: "Burger · kitchen / prep",
    type: "business_spot",
    required: false,
    defaultRadius: 2.5,
  },
  {
    key: "burger_pickup_handoff_spot",
    label: "Burger · pickup handoff",
    type: "business_spot",
    required: false,
    defaultRadius: 2,
  },
  {
    key: "burger_dining_spot",
    label: "Burger · dining",
    type: "business_spot",
    required: false,
    defaultRadius: 3,
  },
  {
    key: "burger_queue_spot",
    label: "Burger · queue",
    type: "business_spot",
    required: false,
    defaultRadius: 2,
  },
  {
    key: "burger_cleanup_spot",
    label: "Burger · cleanup / busser",
    type: "business_spot",
    required: false,
    defaultRadius: 2,
  },
  {
    key: "burger_manager_spot",
    label: "Burger · floor manager",
    type: "business_spot",
    required: false,
    defaultRadius: 2,
  },
];

export const PRESET_MARKER_ORDER = PRESET_MARKER_DEFINITIONS.map((d) => d.key);

export const PRESET_BY_KEY = Object.fromEntries(
  PRESET_MARKER_DEFINITIONS.map((d) => [d.key, d])
) as Record<string, PresetMarkerDef>;

export const REQUIRED_MARKER_KEYS = PRESET_MARKER_DEFINITIONS.filter(
  (d) => d.required
).map((d) => d.key);
