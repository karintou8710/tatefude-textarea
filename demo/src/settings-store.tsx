import { createContext, type ReactNode, useContext, useState } from "react";
import { defaultSettings, type Settings } from "./settings";

interface Store {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
}

const Context = createContext<Store | null>(null);

/** つまみの位置はページを移っても持ち越す。器が変わるだけで、組み方は変えたくない */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState(defaultSettings);
  const update = (patch: Partial<Settings>) => setSettings((prev) => ({ ...prev, ...patch }));

  return <Context value={{ settings, update }}>{children}</Context>;
}

export function useSettings(): Store {
  const store = useContext(Context);
  if (!store) throw new Error("SettingsProvider の外で呼んでいる");
  return store;
}
