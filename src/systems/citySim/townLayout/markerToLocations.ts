import { ENTITY_Y } from "../constants";
import type { CityLocation, CityLocationKind } from "../types";
import type { PlacedMarkerRecord } from "./types";

function markerTypeToLocationKind(
  t: PlacedMarkerRecord["type"]
): CityLocationKind {
  switch (t) {
    case "home":
      return "home";
    case "store":
      return "store";
    case "park":
      return "park";
    case "social":
      return "social";
    default:
      return "outdoor";
  }
}

/** Build simulation CityLocation entries from placed markers only. */
export function placedMarkersToCityLocations(
  markers: Record<string, PlacedMarkerRecord>
): CityLocation[] {
  const list: CityLocation[] = [];
  for (const m of Object.values(markers)) {
    list.push({
      id: m.key,
      label: m.label,
      position: {
        x: m.position.x,
        y: ENTITY_Y,
        z: m.position.z,
      },
      type: markerTypeToLocationKind(m.type),
      interactionRadius: m.radius,
    });
  }
  return list;
}
