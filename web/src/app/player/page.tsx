import React, { Suspense } from "react";
import { LoadingDots } from "@/components/common/LoadingDots";
import PlayerContent from "./PlayerContent";

export default function Page() {
  return (
    <Suspense
      fallback={
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", flex: 1, minHeight: 0 }}>
          <LoadingDots />
        </div>
      }
    >
      <PlayerContent />
    </Suspense>
  );
}
