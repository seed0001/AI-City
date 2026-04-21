import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CitySimManager } from "./CitySimManager";

type CitySimCtx = {
  manager: CitySimManager;
  /** Incrementing counter so UIs can re-read snapshot */
  simVersion: number;
  bump: () => void;
};

const CitySimContext = createContext<CitySimCtx | null>(null);

export function CitySimProvider({ children }: { children: ReactNode }) {
  const managerRef = useRef<CitySimManager | null>(null);
  if (!managerRef.current) {
    managerRef.current = new CitySimManager();
  }

  const [simVersion, setSimVersion] = useState(0);
  const bump = useCallback(() => {
    setSimVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    managerRef.current!.uiBump = bump;
  }, [bump]);

  const value = useMemo(
    () => ({
      manager: managerRef.current!,
      simVersion,
      bump,
    }),
    [simVersion, bump]
  );

  return (
    <CitySimContext.Provider value={value}>{children}</CitySimContext.Provider>
  );
}

export function useCitySimContext(): CitySimCtx {
  const ctx = useContext(CitySimContext);
  if (!ctx) {
    throw new Error("useCitySimContext must be used within CitySimProvider");
  }
  return ctx;
}
