import { Suspense } from "react";
import Scene from "./scene/Scene";
import { CitySimProvider } from "./systems/citySim/CitySimContext";
import { TownLayoutProvider } from "./systems/citySim/townLayout/TownLayoutContext";
import CitySimDebugPanel from "./systems/citySim/components/debug/CitySimDebugPanel";
import LeftHud from "./systems/citySim/components/LeftHud";
import ThinClientApp from "./mobile/ThinClientApp";
import LanHostBridge from "./systems/citySim/network/LanHostBridge";
import ModeLanding from "./ModeLanding";

export default function App() {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get("mode")?.trim();

  if (mode === "client") {
    return <ThinClientApp />;
  }

  /** Default entry: landing so you never have to type query strings by hand. */
  if (!mode || mode === "landing" || mode === "select") {
    return <ModeLanding />;
  }

  const hostMode = mode === "host";

  return (
    <CitySimProvider>
      <TownLayoutProvider>
        <div style={{ position: "fixed", inset: 0, background: "#05050a" }}>
          <Suspense fallback={null}>
            <Scene />
          </Suspense>
          <LeftHud />
          <CitySimDebugPanel />
          {hostMode ? <LanHostBridge /> : null}
        </div>
      </TownLayoutProvider>
    </CitySimProvider>
  );
}
