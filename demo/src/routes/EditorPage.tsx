import { useRef, useState } from "react";
import type { TextareaHandle } from "tatefude-textarea-react";
import { Controls } from "../components/Controls";
import { EditorPane } from "../components/EditorPane";
import { Footer } from "../components/Footer";
import { Header } from "../components/Header";
import { SelectionToolbar } from "../components/SelectionToolbar";
import { useSoftKeyboard } from "../hooks/useSoftKeyboard";
import { useViewportHeight } from "../hooks/useViewportHeight";
import { useSettings } from "../settings-store";
import styles from "./EditorPage.module.css";

interface Props {
  initialText: string;
}

export function EditorPage({ initialText }: Props) {
  const [value, setValue] = useState(initialText);
  const { settings, update } = useSettings();
  const editorRef = useRef<TextareaHandle>(null);
  const [selection, setSelection] = useState({ anchor: 0, head: 0 });
  useViewportHeight();
  // キーボードが出ると縦書きの行はそのぶん短くなる。ヘッダーのぶんまで削らない
  const keyboardOpen = useSoftKeyboard();

  return (
    <div className={styles.page}>
      {!keyboardOpen && <Header />}
      <Controls settings={settings} onChange={update} onFocus={() => editorRef.current?.focus()} />
      <EditorPane
        ref={editorRef}
        settings={settings}
        value={value}
        onChange={setValue}
        onSelectionChange={setSelection}
      />
      <SelectionToolbar
        editor={editorRef.current}
        writingMode={settings.writingMode}
        selection={selection}
      />
      <Footer count={value.length} writingMode={settings.writingMode} />
    </div>
  );
}
