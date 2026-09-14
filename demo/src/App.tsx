import { useRef, useState } from "react";
import type { TextareaHandle } from "tatefude-textarea-react";
import styles from "./App.module.css";
import { Controls } from "./components/Controls";
import { EditorPane } from "./components/EditorPane";
import { Footer } from "./components/Footer";
import { Header } from "./components/Header";
import { useViewportHeight } from "./hooks/useViewportHeight";
import { sampleText } from "./sample";
import { defaultSettings, type Settings } from "./settings";

export function App() {
  const [value, setValue] = useState(sampleText);
  const [settings, setSettings] = useState(defaultSettings);
  const editorRef = useRef<TextareaHandle>(null);
  useViewportHeight();

  const update = (patch: Partial<Settings>) => setSettings((prev) => ({ ...prev, ...patch }));

  return (
    <div className={styles.page}>
      <Header />
      <Controls settings={settings} onChange={update} onFocus={() => editorRef.current?.focus()} />
      <EditorPane ref={editorRef} settings={settings} value={value} onChange={setValue} />
      <Footer count={value.length} writingMode={settings.writingMode} />
    </div>
  );
}
