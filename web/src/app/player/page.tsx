import React, { Suspense } from "react";
import { LoadingDots } from "@/components/common/LoadingDots";
import { AppShell } from "@/components/shell/AppShell";
import PlayerContent from "./PlayerContent";

export default function Page() {
  return (
    <AppShell>
      <Suspense
        fallback={
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", flex: 1, minHeight: 0 }}>
            <LoadingDots />
          </div>
        }
      >
        <PlayerContent />
      </Suspense>
    </AppShell>
  );
}
