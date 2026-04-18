"use client";

import { useEffect } from "react";

export function TauriIndexHtmlFix() {
  useEffect(() => {
    try {
      const p = window.location.pathname || "";
      if (p === "/index.html" || p.endsWith("/index.html")) {
        window.location.replace(p.replace(/\/index\.html$/, "/"));
      }
    } catch {
      // ignore
    }
  }, []);

  return null;
}

