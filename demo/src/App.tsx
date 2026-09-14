import { VertTextarea, type VertTextareaHandle } from "canvas-vert-textarea-react";
import { useRef, useState } from "react";
import { sampleText } from "./sample";
import { usePrefersDark } from "./useColorScheme";

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
  const [linked, setLinked] = useState(true);
  const canvasRef = useRef<VertTextareaHandle>(null);
  const domRef = useRef<VertTextareaHandle>(null);
  const dark = usePrefersDark();

  const shared = {
    kinsoku,
    smallKanaShift,
    font: { family, size, lineHeight },
    padding: 24,
    theme: dark ? darkTheme : lightTheme,
    placeholder: "ここに書く",
  };

  return (
    <div className="page">
      <header>
        <h1>canvas-vert-textarea</h1>
        <p className="lead">
          同じ API の 2 実装を並べています。左が canvas に自前で組むもの、右がブラウザの
          writing-mode に組ませて Range API で読み返すもの。
        </p>
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
        <label className="check">
          <input type="checkbox" checked={linked} onChange={(e) => setLinked(e.target.checked)} />
          本文を連動させる
        </label>
      </div>

      <div className="pair">
        <section>
          <h2>
            canvas <span>字を 1 つずつ置く</span>
            <button type="button" onClick={() => canvasRef.current?.focus()}>
              フォーカス
            </button>
          </h2>
          <div className="editor">
            <VertTextarea
              ref={canvasRef}
              backend="canvas"
              {...shared}
              {...(linked ? { value, onChange: setValue } : { defaultValue: value })}
            />
          </div>
        </section>

        <section>
          <h2>
            dom <span>writing-mode に組ませる</span>
            <button type="button" onClick={() => domRef.current?.focus()}>
              フォーカス
            </button>
          </h2>
          <div className="editor">
            <VertTextarea
              ref={domRef}
              backend="dom"
              {...shared}
              {...(linked ? { value, onChange: setValue } : { defaultValue: value })}
            />
          </div>
        </section>
      </div>

      <footer>
        <span>{value.length} 文字</span>
        <span>↑↓ で行の中を、←→ で行を移る</span>
      </footer>
    </div>
  );
}
