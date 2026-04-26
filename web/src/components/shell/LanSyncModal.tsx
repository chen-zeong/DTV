"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, m } from "framer-motion";
import { Download, Upload, X } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { QRCodeCanvas } from "qrcode.react";

import styles from "./Navbar.module.css";
import { applyIncrementalLanSyncImport, createLanSyncPayload, parseLanSyncManifest, parseLanSyncPayload } from "@/services/lanSync";

type ServerInfo = { port: number; hosts: string[]; token: string };
type DiscoveredPeer = { name: string; host: string; port: number; token?: string | null; baseUrl: string };

const FIXED_PORT = 38999;
const DEFAULT_TOKEN = "dtv";

function pickBestLanHost(hosts: string[]): string | null {
  const ips = (hosts || [])
    .map((h) => String(h || "").trim())
    .filter((h) => h && h !== "localhost" && h !== "127.0.0.1");

  const isApipa = (ip: string) => ip.startsWith("169.254.");
  const isBenchmark = (ip: string) => ip.startsWith("198.18.") || ip.startsWith("198.19.");
  const isCgnat = (ip: string) => {
    const m = /^100\.(\d{1,3})\./.exec(ip);
    if (!m) return false;
    const second = Number(m[1]);
    return Number.isFinite(second) && second >= 64 && second <= 127;
  };
  const isRfc1918 = (ip: string) => {
    if (ip.startsWith("10.")) return true;
    if (ip.startsWith("192.168.")) return true;
    const m = /^172\.(\d{1,3})\./.exec(ip);
    if (!m) return false;
    const second = Number(m[1]);
    return Number.isFinite(second) && second >= 16 && second <= 31;
  };

  const score = (ip: string) => {
    if (isApipa(ip) || isBenchmark(ip)) return -1;
    if (ip.startsWith("192.168.")) return 100;
    if (ip.startsWith("10.")) return 90;
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) return 80;
    if (isCgnat(ip)) return 70;
    if (isRfc1918(ip)) return 60;
    return 0;
  };

  const sorted = [...ips].sort((a, b) => score(b) - score(a) || a.localeCompare(b));
  const best = sorted.find((ip) => score(ip) > 0) ?? null;
  return best;
}

function normalizeImportTarget(input: string, fallbackToken: string): { baseUrl: string; token: string } {
  const raw = String(input || "").trim();
  if (!raw) throw new Error("请输入共享端 IP。");

  if (raw.includes("://")) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new Error("URL 格式不正确。");
    }
    const token = url.searchParams.get("token") || fallbackToken;
    return { baseUrl: url.origin, token };
  }

  const hasPort = raw.includes(":");
  const baseUrl = hasPort ? `http://${raw}` : `http://${raw}:${FIXED_PORT}`;
  return { baseUrl, token: fallbackToken };
}

function normalizeDiscoveredToken(raw: unknown, fallbackToken: string): string {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return fallbackToken;

  // Some peers may accidentally advertise txt like "token=dtv"; normalize to "dtv".
  if (trimmed.includes("token=")) {
    try {
      const params = new URLSearchParams(trimmed.startsWith("?") ? trimmed.slice(1) : trimmed);
      const t = params.get("token");
      if (t) return t;
    } catch {
      // ignore
    }
    const idx = trimmed.lastIndexOf("token=");
    if (idx >= 0) {
      const maybe = trimmed.slice(idx + "token=".length);
      if (maybe) return decodeURIComponent(maybe);
    }
  }

  return trimmed;
}

async function fetchJsonWithTimeout(url: string, timeoutMs: number) {
  const controller = new AbortController();
  const id = window.setTimeout(() => controller.abort(), Math.max(200, timeoutMs));
  try {
    const res = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      cache: "no-store",
      headers: { Accept: "application/json" }
    });
    return res;
  } finally {
    window.clearTimeout(id);
  }
}

export function LanSyncModal({
  open,
  onClose,
  appVersion
}: {
  open: boolean;
  onClose: () => void;
  appVersion?: string;
}) {
  const [tab, setTab] = useState<"export" | "import">("export");

  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [jsonExportBusy, setJsonExportBusy] = useState(false);
  const [jsonExportError, setJsonExportError] = useState<string | null>(null);
  const [jsonExportPath, setJsonExportPath] = useState<string | null>(null);

  const [manualTarget, setManualTarget] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<string | null>(null);

  const canUseStorage = typeof window !== "undefined" && !!window.localStorage;

  const bestHost = useMemo(() => {
    if (!serverInfo?.hosts?.length) return null;
    return pickBestLanHost(serverInfo.hosts);
  }, [serverInfo?.hosts]);

  const shareImportUrl = useMemo(() => {
    const port = serverInfo?.port || FIXED_PORT;
    const host = bestHost;
    const token = serverInfo?.token || DEFAULT_TOKEN;
    if (!host) return null;
    // Share the payload URL for easier manual testing/copying; importer only needs origin + token.
    return `http://${host}:${port}/dtv-sync/payload?token=${encodeURIComponent(token)}`;
  }, [bestHost, serverInfo?.port, serverInfo?.token]);

  useEffect(() => {
    if (!open) return;

    setTab("export");
    setExportBusy(false);
    setExportError(null);
    setJsonExportBusy(false);
    setJsonExportError(null);
    setJsonExportPath(null);
    setImportBusy(false);
    setImportError(null);
    setImportResult(null);
    setManualTarget("");

    void (async () => {
      try {
        const status = (await invoke<any>("lan_sync_status")) as ServerInfo | null;
        if (status?.hosts?.length) setServerInfo(status);
        else setServerInfo(null);
      } catch {
        setServerInfo(null);
      }
    })();
  }, [open]);

  const stopShare = useCallback(async () => {
    setExportBusy(true);
    setExportError(null);
    try {
      await invoke("lan_sync_stop_server");
      setServerInfo(null);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : String(e));
    } finally {
      setExportBusy(false);
    }
  }, []);

  const startShare = useCallback(async () => {
    if (!canUseStorage) return;
    setExportBusy(true);
    setExportError(null);

    try {
      const payload = createLanSyncPayload(window.localStorage, { client: "desktop", appVersion: appVersion || null });
      const res = (await invoke<any>("lan_sync_start_server", { payload })) as ServerInfo;
      setServerInfo(res);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : String(e));
    } finally {
      setExportBusy(false);
    }
  }, [appVersion, canUseStorage]);

  const exportToDesktopJson = useCallback(async () => {
    if (!canUseStorage) return;
    setJsonExportBusy(true);
    setJsonExportError(null);
    setJsonExportPath(null);

    try {
      const payload = createLanSyncPayload(window.localStorage, { client: "desktop", appVersion: appVersion || null });
      const contents = JSON.stringify(payload, null, 2);
      const savedPath = (await invoke<string>("export_lan_sync_json_to_desktop", {
        contents,
        defaultFileName: null
      })) as string;
      setJsonExportPath(savedPath);
    } catch (e) {
      setJsonExportError(e instanceof Error ? e.message : String(e));
    } finally {
      setJsonExportBusy(false);
    }
  }, [appVersion, canUseStorage]);

  const importFromJsonFile = useCallback(async () => {
    if (!canUseStorage) return;
    setImportBusy(true);
    setImportError(null);
    setImportResult(null);

    try {
      const picked = (await invoke<any>("pick_lan_sync_json_import")) as { path: string; content: string } | null;
      if (!picked?.content) return;

      const payload = parseLanSyncPayload(JSON.parse(picked.content));
      const result = applyIncrementalLanSyncImport(window.localStorage, payload.entries);
      const extraParts: string[] = [];
      if (typeof result.addedCustomCategories === "number") extraParts.push(`自定义分区新增 ${result.addedCustomCategories}`);
      if (typeof result.addedDanmuBlockKeywords === "number") extraParts.push(`弹幕屏蔽词新增 ${result.addedDanmuBlockKeywords}`);
      if (result.appliedDanmuPreferences) extraParts.push("已应用弹幕偏好设置");
      const extra = extraParts.length ? `，${extraParts.join("，")}。` : "。";

      setImportResult(
        `导入成功（JSON）：新增关注 ${result.addedStreamers}，新增文件夹 ${result.addedFolderCount}，文件夹新增条目 ${result.addedFolderItems}${extra} 文件：${picked.path}。`
      );
    } catch (e) {
      setImportError(e instanceof Error ? e.message : String(e));
    } finally {
      setImportBusy(false);
    }
  }, [canUseStorage]);

  const importFromDiscoveredPeers = useCallback(async () => {
    if (!canUseStorage) return;
    setImportBusy(true);
    setImportError(null);
    setImportResult("正在搜索可用共享端…");

    try {
      const peers = (await invoke<any>("lan_sync_discover", { timeoutMs: 1600 })) as DiscoveredPeer[];
      if (!Array.isArray(peers) || peers.length === 0) {
        throw new Error("未发现可用共享端：请先在另一台设备点击「开启共享」。");
      }

      const candidates: Array<{ peer: DiscoveredPeer; exportedAt: number; token: string }> = [];
      const probeFailures: Array<{ peer: DiscoveredPeer; reason: string }> = [];

      const settled = await Promise.allSettled(
        peers.map(async (peer) => {
          if (!peer?.baseUrl) throw new Error("Peer baseUrl is empty.");
          const token = normalizeDiscoveredToken(peer.token, DEFAULT_TOKEN);
          const manifest = (await invoke<any>("lan_sync_fetch_manifest", { baseUrl: peer.baseUrl, token })) as any;
          const parsed = parseLanSyncManifest(manifest);
          const exportedAt = Date.parse(parsed.exportedAt);
          return { peer, exportedAt: Number.isFinite(exportedAt) ? exportedAt : 0, token };
        })
      );

      settled.forEach((item, idx) => {
        const peer = peers[idx];
        if (item.status === "fulfilled") {
          candidates.push(item.value);
          return;
        }
        const reasonMsg = item.reason instanceof Error ? item.reason.message : String(item.reason || "Failed to fetch");
        probeFailures.push({ peer, reason: reasonMsg });
      });

      if (!candidates.length) {
        const brief = probeFailures
          .slice(0, 3)
          .map((f) => `${f.peer.host}:${f.peer.port}（失败：${f.reason}）`)
          .join("，");
        const suffix = brief ? ` 探测结果：${brief}` : "";
        throw new Error(`未找到可导入的数据：共享端可能已关闭、token 不匹配，或 mDNS 解析到了不可达 IP（如 169.254.*）。${suffix}`);
      }
      candidates.sort((a, b) => b.exportedAt - a.exportedAt);
      const best = candidates[0];

      const payloadRaw = (await invoke<any>("lan_sync_fetch_payload", { baseUrl: best.peer.baseUrl, token: best.token })) as any;
      const payload = parseLanSyncPayload(payloadRaw);
      const result = applyIncrementalLanSyncImport(window.localStorage, payload.entries);

      const extraParts: string[] = [];
      extraParts.push(`自定义分区新增 ${result.addedCustomCategories}`);
      extraParts.push(`弹幕屏蔽词新增 ${result.addedDanmuBlockKeywords}`);
      if (result.appliedDanmuPreferences) extraParts.push("已应用弹幕偏好设置");
      const extra = extraParts.length ? `，${extraParts.join("，")}。` : "。";

      setImportResult(
        `导入成功（一键）：新增关注 ${result.addedStreamers}，新增文件夹 ${result.addedFolderCount}，文件夹新增条目 ${result.addedFolderItems}${extra} 来源：${best.peer.host}:${best.peer.port}`
      );
    } catch (e) {
      setImportResult(null);
      setImportError(e instanceof Error ? e.message : String(e));
    } finally {
      setImportBusy(false);
    }
  }, [canUseStorage]);

  const confirmImport = useCallback(async () => {
    if (!canUseStorage) return;
    setImportBusy(true);
    setImportError(null);
    setImportResult(null);
    try {
      const { baseUrl, token } = normalizeImportTarget(manualTarget, DEFAULT_TOKEN);
      const payloadRaw = (await invoke<any>("lan_sync_fetch_payload", { baseUrl, token })) as any;
      const payload = parseLanSyncPayload(payloadRaw);
      const result = applyIncrementalLanSyncImport(window.localStorage, payload.entries);
      const extraParts: string[] = [];
      if (typeof result.addedCustomCategories === "number") extraParts.push(`自定义分区新增 ${result.addedCustomCategories}`);
      if (typeof result.addedDanmuBlockKeywords === "number") extraParts.push(`弹幕屏蔽词新增 ${result.addedDanmuBlockKeywords}`);
      if (result.appliedDanmuPreferences) extraParts.push("已应用弹幕偏好设置");
      const extra = extraParts.length ? `，${extraParts.join("，")}。` : "。";
      setImportResult(
        `导入成功：新增关注 ${result.addedStreamers}，新增文件夹 ${result.addedFolderCount}，文件夹新增条目 ${result.addedFolderItems}${extra}`
      );
    } catch (e) {
      setImportError(e instanceof Error ? e.message : String(e));
    } finally {
      setImportBusy(false);
    }
  }, [canUseStorage, manualTarget]);

  const close = useCallback(() => {
    setExportError(null);
    setImportError(null);
    setImportResult(null);
    onClose();
  }, [onClose]);

  if (!open) return null;

  return (
    <AnimatePresence>
      <m.div
        className={styles.overlayBackdrop}
        // eslint-disable-next-line react/no-unknown-property
        data-tauri-drag-region="false"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onMouseDown={() => close()}
      >
        <m.div
          className={styles.overlayCard}
          initial={{ opacity: 0, y: 10, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.99 }}
          transition={{ type: "spring", stiffness: 520, damping: 44, mass: 0.7 }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className={styles.overlayHeader}>
            <div className={styles.overlayTitle}>数据同步</div>
            <button type="button" className={`${styles.overlayClose} ${styles.syncBtnGlass}`} onClick={() => close()} aria-label="关闭">
              <X size={16} />
            </button>
          </div>

          <div className={styles.overlayBody}>
            <div className={styles.syncTabs} aria-label="sync tabs">
              <button
                type="button"
                className={`${styles.syncTab} ${styles.syncBtnGlass} ${tab === "export" ? styles.syncTabActive : ""}`}
                onClick={() => setTab("export")}
              >
                <Upload size={16} />
                导出
              </button>
              <button
                type="button"
                className={`${styles.syncTab} ${styles.syncBtnGlass} ${tab === "import" ? styles.syncTabActive : ""}`}
                onClick={() => setTab("import")}
              >
                <Download size={16} />
                导入
              </button>
            </div>

            {tab === "export" ? (
              <>
                {serverInfo?.hosts?.length && shareImportUrl ? (
                  <div className={styles.syncQrBlock} aria-label="lan-qr">
                    <div className={styles.syncQrCanvasWrap}>
                      <QRCodeCanvas
                        value={shareImportUrl}
                        size={200}
                        includeMargin
                        level="M"
                        bgColor="#ffffff"
                        fgColor="#111827"
                      />
                    </div>
                  </div>
                ) : null}

                {serverInfo?.hosts?.length && bestHost ? (
                  <div className={styles.syncMetaGrid} aria-label="share-meta">
                    <div className={styles.syncMetaItem}>
                      <div className={styles.syncMetaKey}>IP</div>
                      <div className={styles.syncMetaVal}>{bestHost}</div>
                    </div>
                    <div className={styles.syncMetaItem}>
                      <div className={styles.syncMetaKey}>端口</div>
                      <div className={styles.syncMetaVal}>{serverInfo?.port || FIXED_PORT}</div>
                    </div>
                  </div>
                ) : null}

                {jsonExportError ? (
                  <p className={styles.syncHint} style={{ color: "rgba(239, 68, 68, 0.95)" }}>
                    {jsonExportError}
                  </p>
                ) : null}

                {exportError ? (
                  <p className={styles.syncHint} style={{ color: "rgba(239, 68, 68, 0.95)" }}>
                    {exportError}
                  </p>
                ) : null}

                {jsonExportPath ? (
                  <p className={styles.syncHint} style={{ color: "rgba(34, 197, 94, 0.95)" }}>
                    导出成功：已导出到桌面。文件：{jsonExportPath}
                  </p>
                ) : null}

                <div className={styles.syncActionsRow}>
                  <button
                    type="button"
                    className={`${styles.secondaryBtn} ${styles.syncBigBtn} ${styles.syncBtnGlass}`}
                    onClick={() => void exportToDesktopJson()}
                    disabled={jsonExportBusy || !canUseStorage}
                  >
                    导出 JSON
                  </button>

                  {serverInfo?.hosts?.length ? (
                    <button
                      type="button"
                      className={`${styles.dangerBtn} ${styles.syncBigBtn} ${styles.syncBtnGlass}`}
                      onClick={() => void stopShare()}
                      disabled={exportBusy}
                    >
                      结束共享
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={`${styles.primaryBtn} ${styles.syncBigBtn} ${styles.syncBtnGlass}`}
                      onClick={() => void startShare()}
                      disabled={exportBusy || !canUseStorage}
                    >
                      开启共享
                    </button>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className={styles.syncActionsRow} aria-label="json-import-actions">
                  <button
                    type="button"
                    className={`${styles.primaryBtn} ${styles.syncBtnGlass}`}
                    onClick={() => void importFromDiscoveredPeers()}
                    disabled={importBusy || !canUseStorage}
                  >
                    一键导入
                  </button>
                  <button
                    type="button"
                    className={`${styles.secondaryBtn} ${styles.syncBtnGlass}`}
                    onClick={() => void importFromJsonFile()}
                    disabled={importBusy || !canUseStorage}
                  >
                    导入 JSON
                  </button>
                </div>

                <div className={styles.syncField}>
                  <input
                    className={styles.syncInput}
                    value={manualTarget}
                    onChange={(e) => setManualTarget(e.target.value)}
                    placeholder="共享端 IP，例如：192.168.1.8"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                </div>

                {importError ? (
                  <p className={styles.syncHint} style={{ color: "rgba(239, 68, 68, 0.95)" }}>
                    {importError}
                  </p>
                ) : null}

                {importResult ? <p className={styles.syncHint}>{importResult}</p> : null}

                <div className={styles.syncActionsRow}>
                  <button
                    type="button"
                    className={`${styles.primaryBtn} ${styles.syncBtnGlass}`}
                    onClick={() => void confirmImport()}
                    disabled={importBusy || !manualTarget.trim() || !canUseStorage}
                  >
                    导入
                  </button>
                  {importResult ? (
                    <button
                      type="button"
                      className={`${styles.secondaryBtn} ${styles.syncBtnGlass}`}
                      onClick={() => window.location.reload()}
                    >
                      刷新应用
                    </button>
                  ) : null}
                </div>
              </>
            )}
          </div>
        </m.div>
      </m.div>
    </AnimatePresence>
  );
}
