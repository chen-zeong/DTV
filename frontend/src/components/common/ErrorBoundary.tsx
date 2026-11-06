import { Component, type ErrorInfo, type ReactNode } from "react";
import { RotateCw, TriangleAlert } from "lucide-react";
import styles from "./ErrorBoundary.module.css";

interface Props {
  children: ReactNode;
  /** 路由变化时用新 key 重置边界 */
  resetKey?: string;
}

interface State {
  error: Error | null;
  info: ErrorInfo | null;
}

/**
 * 全局错误边界（U-18）。
 *
 * 任何渲染异常都只影响当前路由，不再整页白屏；提供重新加载、
 * 回到首页和复制错误信息三个出口。路由 key 变化时自动重置。
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ info });
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  componentDidUpdate(prevProps: Props) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null, info: null });
    }
  }

  private reload = () => {
    window.location.reload();
  };

  private goHome = () => {
    window.location.hash = "#/";
    this.setState({ error: null, info: null });
  };

  private copy = () => {
    const { error, info } = this.state;
    const text = [
      error?.message ?? "未知错误",
      error?.stack ?? "",
      info?.componentStack ?? "",
    ].join("\n");
    void navigator.clipboard?.writeText(text).catch(() => undefined);
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className={styles.root} role="alert">
        <span className={styles.icon}>
          <TriangleAlert size={26} strokeWidth={2} />
        </span>
        <h1 className={styles.title}>页面出错了</h1>
        <p className={styles.message}>{error.message || "未知渲染错误"}</p>
        <div className={styles.actions}>
          <button type="button" className={styles.primary} onClick={this.reload}>
            <RotateCw size={14} strokeWidth={2.4} />
            重新加载
          </button>
          <button type="button" className={styles.ghost} onClick={this.goHome}>
            回到首页
          </button>
          <button type="button" className={styles.ghost} onClick={this.copy}>
            复制错误信息
          </button>
        </div>
      </div>
    );
  }
}
