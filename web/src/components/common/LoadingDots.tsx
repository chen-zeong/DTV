"use client";

import styles from "./LoadingDots.module.css";

export function LoadingDots() {
  return (
    <div className={styles.loadingDots} role="status" aria-live="polite" aria-label="加载中">
      <span className={styles.dot} />
      <span className={styles.dot} />
      <span className={styles.dot} />
    </div>
  );
}

