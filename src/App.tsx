import { Suspense } from "react";
import Scene from "./scene/Scene";
import { CitySimProvider } from "./systems/citySim/CitySimContext";
import { TownLayoutProvider } from "./systems/citySim/townLayout/TownLayoutContext";
import CitySimDebugPanel from "./systems/citySim/components/debug/CitySimDebugPanel";
import LeftHud from "./systems/citySim/components/LeftHud";

export default function App() {
  return (
    <CitySimProvider>
      <TownLayoutProvider>
        <div style={{ position: "fixed", inset: 0, background: "#05050a" }}>
          <Suspense fallback={null}>
            <Scene />
          </Suspense>
          <LeftHud />
          <CitySimDebugPanel />
        </div>
      </TownLayoutProvider>
    </CitySimProvider>
  );
}
