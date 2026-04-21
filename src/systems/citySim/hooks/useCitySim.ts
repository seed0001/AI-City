import { useCitySimContext } from "../CitySimContext";
import type { TownEntity } from "../types";

export function useCitySim() {
  const { manager, simVersion, bump } = useCitySimContext();

  return {
    manager,
    simVersion,
    bump,
    getSnapshot: (): { entities: TownEntity[]; tick: number } =>
      manager.snapshot(),
  };
}
