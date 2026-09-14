import type { Ref } from "react";
import { Textarea, type TextareaHandle } from "tatefude-textarea-react";
import { usePrefersDark } from "../hooks/useColorScheme";
import { editorStyle, type Settings } from "../settings";
import { darkTheme, lightTheme } from "../theme";
import styles from "./EditorPane.module.css";

interface Props {
  settings: Settings;
  value: string;
  onChange: (value: string) => void;
  ref?: Ref<TextareaHandle>;
}

export function EditorPane({ settings, value, onChange, ref }: Props) {
  const dark = usePrefersDark();

  return (
    <div className={styles.stage}>
      <div className={styles.editor}>
        <Textarea
          ref={ref}
          writingMode={settings.writingMode}
          theme={dark ? darkTheme : lightTheme}
          style={editorStyle(settings)}
          placeholder="ここに書く"
          value={value}
          onChange={onChange}
        />
      </div>
    </div>
  );
}
