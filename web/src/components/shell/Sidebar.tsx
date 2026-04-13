"use client";

import React from "react";
import styles from "./Sidebar.module.css";
import { FollowsList } from "@/components/follows/FollowsList";

export function Sidebar({
  isCollapsed
}: {
  isCollapsed: boolean;
}) {
  return (
    <aside
      className={styles.sidebarShell}
      style={{
        width: isCollapsed ? "var(--sidebar-collapsed-width)" : "var(--sidebar-width)",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        transition: "none"
      }}
    >
      {!isCollapsed ? (
        <div className={styles.sidebarBody}>
          <FollowsList />
        </div>
      ) : null}
    </aside>
  );
}
