import type { WritingMode } from "tatefude-textarea";
import { fonts, type Settings } from "../settings";
import styles from "./Controls.module.css";

interface Props {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  onFocus: () => void;
}

export function Controls({ settings, onChange, onFocus }: Props) {
  const { size, lineHeight, family, kinsoku, writingMode } = settings;

  return (
    <div className={styles.controls}>
      <label>
        字の大きさ
        <input
          type="range"
          min={12}
          max={40}
          value={size}
          onChange={(e) => onChange({ size: Number(e.target.value) })}
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
          onChange={(e) => onChange({ lineHeight: Number(e.target.value) })}
        />
        <output>{lineHeight.toFixed(1)}</output>
      </label>
      <label>
        組み方
        <select
          value={writingMode}
          onChange={(e) => onChange({ writingMode: e.target.value as WritingMode })}
        >
          <option value="vertical-rl">縦書き</option>
          <option value="horizontal-tb">横書き</option>
        </select>
      </label>
      <label>
        書体
        <select value={family} onChange={(e) => onChange({ family: e.target.value })}>
          {fonts.map((font) => (
            <option key={font.label} value={font.value}>
              {font.label}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.check}>
        <input
          type="checkbox"
          checked={kinsoku}
          onChange={(e) => onChange({ kinsoku: e.target.checked })}
        />
        禁則処理
      </label>
      <button type="button" className={styles.focus} onClick={onFocus}>
        フォーカス
      </button>
    </div>
  );
}
