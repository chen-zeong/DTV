"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, m } from "framer-motion";
import { Download, Upload, X } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { QRCodeCanvas } from "qrcode.react";

import styles from "./Navbar.module.css";
import { applyIncrementalLanSyncImport, createLanSyncPayload } from "@/services/lanSync";

type ServerInfo = { port: number; hosts: string[]; token: string };

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

async function copyText(text: string): Promise<void> {
  const value = String(text || "");
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    return;
  } catch {
    // ignore and fallback
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = value;
    ta.setAttribute("readonly", "true");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.style.top = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  } catch {
    // ignore
  }
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

  const [manualTarget, setManualTarget] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<string | null>(null);

  const canUseStorage = typeof window !== "undefined" && !!window.localStorage;

  const shareIpText = useMemo(() => {
    const hosts = serverInfo?.hosts ?? [];
    const best = pickBestLanHost(hosts);
    return best ?? "未获取到";
  }, [serverInfo?.hosts]);

  const shareImportUrl = useMemo(() => {
    const port = serverInfo?.port || FIXED_PORT;
    const host = serverInfo?.hosts?.length ? pickBestLanHost(serverInfo.hosts) : null;
    const token = serverInfo?.token || DEFAULT_TOKEN;
    if (!host) return null;
    // Use manifest endpoint: smaller and still carries token; importer only needs origin + token.
    return `http://${host}:${port}/dtv-sync?token=${encodeURIComponent(token)}`;
  }, [serverInfo?.hosts, serverInfo?.port, serverInfo?.token]);

  useEffect(() => {
    if (!open) return;

    setTab("export");
    setExportBusy(false);
    setExportError(null);
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

  const confirmImport = useCallback(async () => {
    if (!canUseStorage) return;
    setImportBusy(true);
    setImportError(null);
    setImportResult(null);
    try {
      const { baseUrl, token } = normalizeImportTarget(manualTarget, DEFAULT_TOKEN);
      const payloadUrl = `${baseUrl}/dtv-sync/payload?token=${encodeURIComponent(token || DEFAULT_TOKEN)}`;
      const res = await fetch(payloadUrl, { method: "GET" });
      if (!res.ok) throw new Error(`下载数据失败：${res.status} ${res.statusText}`);
      const json = await res.json();
      const remoteEntries = (json?.entries ?? null) as Record<string, string> | null;
      if (!remoteEntries || typeof remoteEntries !== "object") throw new Error("同步数据格式不正确。");
      const result = applyIncrementalLanSyncImport(window.localStorage, remoteEntries);
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
            <div className={styles.overlayTitle}>数据同步（局域网）</div>
            <button type="button" className={styles.overlayClose} onClick={() => close()} aria-label="关闭">
              <X size={16} />
            </button>
          </div>

          <div className={styles.overlayBody}>
            <div className={styles.syncTabs} aria-label="sync tabs">
              <button type="button" className={`${styles.syncTab} ${tab === "export" ? styles.syncTabActive : ""}`} onClick={() => setTab("export")}>
                <Upload size={16} />
                导出共享
              </button>
              <button type="button" className={`${styles.syncTab} ${tab === "import" ? styles.syncTabActive : ""}`} onClick={() => setTab("import")}>
                <Download size={16} />
                导入
              </button>
            </div>

            {tab === "export" ? (
              <>
                <p className={styles.syncHint}>
                  固定端口 {FIXED_PORT}。接收端手动输入共享端 IP 导入（增量导入，自动跳过重复）。首次开启可能会弹出防火墙提示。
                </p>

                {serverInfo?.hosts?.length ? (
                  <div className={styles.syncUrlList} aria-label="hosts">
                    <div className={styles.syncUrlItem}>
                      <div className={styles.syncUrlText}>本机 IP：{shareIpText}</div>
                    </div>
                    <div className={styles.syncUrlItem}>
                      <div className={styles.syncUrlText}>共享端口：{serverInfo.port || FIXED_PORT}</div>
                    </div>
                  </div>
                ) : null}

                {serverInfo?.hosts?.length && shareImportUrl ? (
                  <div className={styles.syncQrBlock} aria-label="scan-import">
                    <div className={styles.syncQrTitle}>扫码导入（移动端）</div>
                    <div className={styles.syncQrHint}>用手机扫码后复制链接，粘贴到“导入”里即可。</div>
                    <div className={styles.syncQrCanvasWrap}>
                      <QRCodeCanvas
                        value={shareImportUrl}
                        size={200}
                        includeMargin
                        level="M"
                        bgColor="transparent"
                        fgColor="white"
                      />
                    </div>
                    <div className={styles.syncUrlText} style={{ marginTop: 8 }}>
                      {shareImportUrl}
                    </div>
                    <div className={styles.syncActionsRow}>
                      <button
                        type="button"
                        className={styles.primaryBtn}
                        onClick={() => void copyText(shareImportUrl)}
                        disabled={!shareImportUrl}
                      >
                        复制导入链接
                      </button>
                    </div>
                  </div>
                ) : null}

                {exportError ? (
                  <p className={styles.syncHint} style={{ color: "rgba(239, 68, 68, 0.95)" }}>
                    {exportError}
                  </p>
                ) : null}

                {serverInfo?.hosts?.length ? (
                  <button type="button" className={`${styles.dangerBtn} ${styles.syncBigBtn}`} onClick={() => void stopShare()} disabled={exportBusy}>
                    结束共享
                  </button>
                ) : (
                  <button
                    type="button"
                    className={`${styles.primaryBtn} ${styles.syncBigBtn}`}
                    onClick={() => void startShare()}
                    disabled={exportBusy || !canUseStorage}
                  >
                    开始共享
                  </button>
                )}
              </>
            ) : (
              <>
                <p className={styles.syncHint}>导入：同一局域网内使用。导入为增量，会自动跳过重复（不会覆盖）。</p>

                <div className={styles.syncField}>
                  <div className={styles.syncLabel}>共享端 IP</div>
                  <input
                    className={styles.syncInput}
                    value={manualTarget}
                    onChange={(e) => setManualTarget(e.target.value)}
                    placeholder={`例如：192.168.1.8（端口固定 ${FIXED_PORT}）`}
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
                    className={styles.primaryBtn}
                    onClick={() => void confirmImport()}
                    disabled={importBusy || !manualTarget.trim() || !canUseStorage}
                  >
                    导入
                  </button>
                  {importResult ? (
                    <button type="button" className={styles.secondaryBtn} onClick={() => window.location.reload()}>
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
