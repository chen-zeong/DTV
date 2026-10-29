import { useNavigate } from "react-router-dom";

export function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <div
      style={{
        display: "flex",
        flex: 1,
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
      }}
    >
      <p style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>页面不存在</p>
      <button
        type="button"
        onClick={() => navigate("/")}
        style={{
          padding: "8px 20px",
          borderRadius: 999,
          fontWeight: 700,
          color: "#fff",
          background: "var(--accent-gradient)",
        }}
      >
        返回首页
      </button>
    </div>
  );
}
