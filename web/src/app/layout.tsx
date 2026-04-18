import type { Metadata } from "next";

import "./globals.css";
import { Providers } from "@/components/providers/Providers";
import { AppShell } from "@/components/shell/AppShell";
import { MotionProvider } from "@/components/motion/MotionProvider";
import { TauriIndexHtmlFix } from "@/components/app/TauriIndexHtmlFix";

export const metadata: Metadata = {
  title: "DTV",
  description: "DTV - Tauri Live Client"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <TauriIndexHtmlFix />
        <Providers>
          <MotionProvider>
            <AppShell>{children}</AppShell>
          </MotionProvider>
        </Providers>
      </body>
    </html>
  );
}
