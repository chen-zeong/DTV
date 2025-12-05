import { ThemeResolved } from "@/stores/theme-store";

type BackgroundFeedProps = {
  theme: ThemeResolved;
};

export function BackgroundFeed({ theme }: BackgroundFeedProps) {
  const gradient =
    theme === "dark"
      ? "bg-gradient-to-br from-[#0a0f1a] via-[#0c1220] to-[#080c16]"
      : "bg-gradient-to-br from-[#eaf2ff] via-[#f6f9ff] to-white";

  return <div className={`absolute inset-0 z-0 ${gradient}`} />;
}
