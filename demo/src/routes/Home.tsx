import { Link } from "@tanstack/react-router";
import { Header } from "../components/Header";
import styles from "./Home.module.css";

export function Home() {
  return (
    <div className={styles.page}>
      <Header />
      <p className={styles.lead}>
        縦書きと横書きのテキストエリア。組版はブラウザに任せ、編集を自前で持つ。
        書体・字の大きさ・行送り・禁則はどちらのページでも動かせる。
      </p>
      <nav className={styles.cards}>
        <Link to="/empty" className={styles.card}>
          <h2>空ページ</h2>
          <p>何も入っていないコンテナ。打ち始めから試す</p>
        </Link>
        <Link to="/sample" className={styles.card}>
          <h2>サンプルページ</h2>
          <p>『吾輩は猫である』を入れたコンテナ。折り返しと禁則を見る</p>
        </Link>
      </nav>
    </div>
  );
}
