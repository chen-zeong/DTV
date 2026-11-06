import { Compass } from "lucide-react";
import { useNavigate } from "react-router-dom";
import styles from "./NotFoundPage.module.css";

export function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <div className={styles.root}>
      <span className={styles.icon}>
        <Compass size={26} strokeWidth={1.6} />
      </span>
      <p className={styles.title}>页面不存在</p>
      <p className={styles.hint}>这个地址可能已经失效，或者还没有对应的页面</p>
      <button type="button" className={styles.btn} onClick={() => navigate("/")}>
        返回首页
      </button>
    </div>
  );
}
