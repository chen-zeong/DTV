import type { Metadata } from "next";
import Script from "next/script";

import "./globals.css";
import { Providers } from "@/components/providers/Providers";
import { AppShell } from "@/components/shell/AppShell";

export const metadata: Metadata = {
  title: "DTV",
  description: "DTV - Tauri Live Client"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <Script id="tauri-index-html-fix" strategy="beforeInteractive">
          {`(function(){try{var p=location.pathname||"";if(p==="/index.html"||p.endsWith("/index.html")){location.replace(p.replace(/\\/index\\.html$/,"/"));}}catch(e){}})();`}
        </Script>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
