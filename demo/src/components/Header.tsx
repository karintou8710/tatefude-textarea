import styles from "./Header.module.css";

export function Header() {
  return (
    <header className={styles.header}>
      <h1>tatefude-textarea</h1>
      <p className={styles.lead}>ブラウザの writing-mode に組ませて、Range API で読み返す実装。</p>
    </header>
  );
}
