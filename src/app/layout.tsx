import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DTV Next UI",
  description: "Next.js 版本的新 UI 原型",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
