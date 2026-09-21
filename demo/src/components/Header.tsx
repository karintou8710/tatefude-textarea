import { Link } from "@tanstack/react-router";
import styles from "./Header.module.css";

export function Header() {
  return (
    <header className={styles.header}>
      <h1 className={styles.title}>tatefude-textarea</h1>
      <nav className={styles.nav}>
        <Link to="/" activeOptions={{ exact: true }}>
          ホーム
        </Link>
        <Link to="/empty">空</Link>
        <Link to="/sample">サンプル</Link>
      </nav>
    </header>
  );
}
