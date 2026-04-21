import type { CityLocation } from "../types";

/**
 * Named anchor points in world space (BurgerPiz map is centered near origin, floor ~y=0).
 * Tune positions to match your map layout.
 */
export const CITY_LOCATIONS: CityLocation[] = [
  {
    id: "hotel_entry",
    label: "Hotel entrance",
    position: { x: -8, y: 1.65, z: 6 },
    type: "entry",
    interactionRadius: 3,
  },
  {
    id: "hotel_lobby",
    label: "Hotel lobby",
    position: { x: -10, y: 1.65, z: 2 },
    type: "interior",
    interactionRadius: 4,
  },
  {
    id: "burger_joint_entry",
    label: "Burger joint entrance",
    position: { x: 6, y: 1.65, z: 4 },
    type: "entry",
    interactionRadius: 3,
  },
  {
    id: "burger_joint_counter",
    label: "Counter",
    position: { x: 8, y: 1.65, z: 6 },
    type: "interior",
    interactionRadius: 2.5,
  },
  {
    id: "burger_joint_booth_1",
    label: "Corner booth",
    position: { x: 5, y: 1.65, z: 8 },
    type: "interior",
    interactionRadius: 2,
  },
  {
    id: "sidewalk_corner_1",
    label: "Sidewalk corner",
    position: { x: 0, y: 1.65, z: -12 },
    type: "path",
    interactionRadius: 4,
  },
  {
    id: "bench_park",
    label: "Park bench",
    position: { x: -14, y: 1.65, z: -6 },
    type: "outdoor",
    interactionRadius: 3,
  },
  {
    id: "street_spot_1",
    label: "Street crossing",
    position: { x: 12, y: 1.65, z: -4 },
    type: "path",
    interactionRadius: 4,
  },
];
