import type { SavedTownLayout } from "./types";

export const TOWN_LAYOUT_STORAGE_KEY = "ai-city-town-layout-v1";

export function loadTownLayoutFromStorage(): SavedTownLayout | null {
  try {
    const raw = localStorage.getItem(TOWN_LAYOUT_STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as SavedTownLayout;
    if (data?.version !== 1 || !data.markers || typeof data.markers !== "object") {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

export function saveTownLayoutToStorage(layout: SavedTownLayout): void {
  localStorage.setItem(TOWN_LAYOUT_STORAGE_KEY, JSON.stringify(layout));
}
