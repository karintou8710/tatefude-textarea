import { useRef, useState } from "react";
import type { WritingMode } from "tatefude-textarea";
import { Textarea, type TextareaHandle } from "tatefude-textarea-react";
import { sampleText } from "./sample";
import { usePrefersDark } from "./useColorScheme";
import { useViewportHeight } from "./useViewportHeight";

const lightTheme = {
  text: "#1a1a1a",
  placeholder: "#a8a29a",
  caret: "#1a1a1a",
  selection: "#b9d8f7",
  selectionInactive: "#e0ddd6",
  composition: "#1a1a1a",
  compositionActive: "#2563eb",
};

const darkTheme = {
  text: "#ece7dd",
  placeholder: "#6b665d",
  caret: "#ece7dd",
  selection: "#2f4c6b",
  selectionInactive: "#2b2822",
  composition: "#ece7dd",
  compositionActive: "#7aa7ff",
};

const fonts = [
  { label: "明朝", value: '"Hiragino Mincho ProN", "Yu Mincho", "Noto Serif JP", serif' },
  { label: "ゴシック", value: '"Hiragino Sans", "Yu Gothic", "Noto Sans JP", sans-serif' },
];

export function App() {
  const [value, setValue] = useState(sampleText);
  const [size, setSize] = useState(20);
  const [lineHeight, setLineHeight] = useState(1.8);
  const [family, setFamily] = useState(fonts[0].value);
  const [kinsoku, setKinsoku] = useState(true);
  const [smallKanaShift, setSmallKanaShift] = useState(0.08);
  const [writingMode, setWritingMode] = useState<WritingMode>("vertical-rl");
  const editorRef = useRef<TextareaHandle>(null);
  const dark = usePrefersDark();
  useViewportHeight();

  return (
    <div className="page">
      <header>
        <h1>tatefude-textarea</h1>
        <p className="lead">ブラウザの writing-mode に組ませて、Range API で読み返す実装。</p>
      </header>

      <div className="controls">
        <label>
          字の大きさ
          <input
            type="range"
            min={12}
            max={40}
            value={size}
            onChange={(e) => setSize(Number(e.target.value))}
          />
          <output>{size}px</output>
        </label>
        <label>
          行送り
          <input
            type="range"
            min={1}
            max={3}
            step={0.1}
            value={lineHeight}
            onChange={(e) => setLineHeight(Number(e.target.value))}
          />
          <output>{lineHeight.toFixed(1)}</output>
        </label>
        <label>
          組み方
          <select
            value={writingMode}
            onChange={(e) => setWritingMode(e.target.value as WritingMode)}
          >
            <option value="vertical-rl">縦書き</option>
            <option value="horizontal-tb">横書き</option>
          </select>
        </label>
        <label>
          書体
          <select value={family} onChange={(e) => setFamily(e.target.value)}>
            {fonts.map((font) => (
              <option key={font.label} value={font.value}>
                {font.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          小書き仮名のずらし
          <input
            type="range"
            min={0}
            max={0.2}
            step={0.01}
            value={smallKanaShift}
            onChange={(e) => setSmallKanaShift(Number(e.target.value))}
          />
          <output>{smallKanaShift.toFixed(2)}em</output>
        </label>
        <label className="check">
          <input type="checkbox" checked={kinsoku} onChange={(e) => setKinsoku(e.target.checked)} />
          禁則処理
        </label>
        <button type="button" onClick={() => editorRef.current?.focus()}>
          フォーカス
        </button>
      </div>

      <div className="stage">
        <div className="editor">
          <Textarea
            ref={editorRef}
            backend="dom"
            writingMode={writingMode}
            kinsoku={kinsoku}
            smallKanaShift={smallKanaShift}
            font={{ family, size, lineHeight }}
            padding={24}
            theme={dark ? darkTheme : lightTheme}
            placeholder="ここに書く"
            value={value}
            onChange={setValue}
          />
        </div>
      </div>

      <footer>
        <span>{value.length} 文字</span>
        <span>
          {writingMode === "vertical-rl"
            ? "↑↓ で 1 文字ずつ、←→ で行を移る"
            : "←→ で 1 文字ずつ、↑↓ で行を移る"}
        </span>
      </footer>
    </div>
  );
}
