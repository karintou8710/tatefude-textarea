import type { WritingMode } from "tatefude-textarea";
import styles from "./Footer.module.css";

interface Props {
  count: number;
  writingMode: WritingMode;
}

export function Footer({ count, writingMode }: Props) {
  return (
    <footer className={styles.footer}>
      <span>{count} 文字</span>
      <span>
        {writingMode === "vertical-rl"
          ? "↑↓ で 1 文字ずつ、←→ で行を移る"
          : "←→ で 1 文字ずつ、↑↓ で行を移る"}
      </span>
    </footer>
  );
}
