"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, m } from "framer-motion";
import { Download, Upload, X } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { QRCodeCanvas } from "qrcode.react";

import styles from "./Navbar.module.css";
import {
  applyIncrementalLanSyncImport,
  createLanSyncPayload,
  parseLanSyncManifest,
  type LanSyncManifest
} from "@/services/lanSync";

type ServerInfo = { port: number; hosts: string[]; token: string };
type DiscoveredPeer = { name: string; host: string; port: number; token?: string | null; baseUrl: string };

const FIXED_PORT = 38999;

function normalizeImportTarget(input: string, fallbackToken: string): { baseUrl: string; token: string } {
  const raw = String(input || "").trim();
  if (!raw) throw new Error("请输入共享端 URL 或 IP。");

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
  const [lanToken, setLanToken] = useState<string>("");
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState(false);

  const [manualTarget, setManualTarget] = useState("");
  const [discoveredPeers, setDiscoveredPeers] = useState<DiscoveredPeer[]>([]);
  const [selectedPeer, setSelectedPeer] = useState<DiscoveredPeer | null>(null);
  const [discoveredBaseUrl, setDiscoveredBaseUrl] = useState<string | null>(null);
  const [discoveredToken, setDiscoveredToken] = useState<string | null>(null);
  const [manifest, setManifest] = useState<LanSyncManifest | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<string | null>(null);

  const [scanOpen, setScanOpen] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanBusy, setScanBusy] = useState(false);
  const scanAbortRef = useRef(false);
  const scanStreamRef = useRef<MediaStream | null>(null);

  const canUseStorage = typeof window !== "undefined" && !!window.localStorage;

  const localSummary = useMemo(() => {
    if (!canUseStorage) return { followed: 0, folders: 0, custom: 0 };
    try {
      const followed = JSON.parse(window.localStorage.getItem("followedStreamers") || "[]");
      const folders = JSON.parse(window.localStorage.getItem("followFolders") || "[]");
      const custom = JSON.parse(window.localStorage.getItem("dtv_custom_categories_v1") || "[]");
      return {
        followed: Array.isArray(followed) ? followed.length : 0,
        folders: Array.isArray(folders) ? folders.length : 0,
        custom: Array.isArray(custom) ? custom.length : 0
      };
    } catch {
      return { followed: 0, folders: 0, custom: 0 };
    }
  }, [canUseStorage, open]);

  const shareUrl = useMemo(() => {
    if (!serverInfo?.hosts?.length) return null;
    const token = serverInfo.token || lanToken || "dtv";
    const host = serverInfo.hosts.find((h) => h !== "localhost" && h !== "127.0.0.1") || "127.0.0.1";
    return `http://${host}:${serverInfo.port || FIXED_PORT}/dtv-sync?token=${encodeURIComponent(token)}`;
  }, [lanToken, serverInfo]);

  useEffect(() => {
    if (!open) return;
    setExportError(null);
    setImportError(null);
    setImportResult(null);
    setManifest(null);
    setDiscoveredBaseUrl(null);
    setDiscoveredToken(null);
    setManualTarget("");
    setDiscoveredPeers([]);
    setSelectedPeer(null);
    setScanOpen(false);
    setScanError(null);
    setTab("export");

    void (async () => {
      try {
        const [status, token] = await Promise.all([
          invoke<any>("lan_sync_status") as Promise<ServerInfo | null>,
          invoke<string>("lan_sync_token")
        ]);
        setLanToken(token || "");
        if (status?.hosts?.length) setServerInfo(status);
      } catch {
        // ignore
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
    setImportResult(null);

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

  const discoverPeers = useCallback(async () => {
    setImportBusy(true);
    setImportError(null);
    setImportResult(null);
    try {
      const peers = (await invoke<any>("lan_sync_discover", { timeout_ms: 1200 })) as DiscoveredPeer[];
      const nextPeers = Array.isArray(peers) ? peers : [];
      setDiscoveredPeers(nextPeers);
      setSelectedPeer(nextPeers.length ? nextPeers[0] : null);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : String(e));
    } finally {
      setImportBusy(false);
    }
  }, []);

  const fetchPreview = useCallback(async () => {
    setImportBusy(true);
    setImportError(null);
    setImportResult(null);
    setManifest(null);
    setDiscoveredBaseUrl(null);
    setDiscoveredToken(null);
    try {
      const fallbackToken = lanToken || "dtv";
      const baseFromPeer = selectedPeer?.baseUrl
        ? { baseUrl: selectedPeer.baseUrl, token: selectedPeer.token || fallbackToken }
        : null;
      const parsed = manualTarget.trim() ? normalizeImportTarget(manualTarget, fallbackToken) : null;
      const target = parsed || baseFromPeer;
      if (!target) throw new Error("请先“自动发现”选择设备，或手动输入 URL/IP。");

      const { baseUrl, token } = target;
      const res = await fetch(`${baseUrl}/dtv-sync?token=${encodeURIComponent(token)}`, { method: "GET" });
      if (!res.ok) throw new Error(`获取预览失败：${res.status} ${res.statusText}`);
      const json = await res.json();
      setDiscoveredBaseUrl(baseUrl);
      setDiscoveredToken(token);
      setManifest(parseLanSyncManifest(json));
    } catch (e) {
      setImportError(e instanceof Error ? e.message : String(e));
    } finally {
      setImportBusy(false);
    }
  }, [lanToken, manualTarget, selectedPeer]);

  const confirmImport = useCallback(async () => {
    if (!canUseStorage) return;
    setImportBusy(true);
    setImportError(null);
    setImportResult(null);
    try {
      if (!discoveredBaseUrl || !discoveredToken) throw new Error("请先点击“预览”。");
      const payloadUrl = `${discoveredBaseUrl}/dtv-sync/payload?token=${encodeURIComponent(discoveredToken)}`;
      const res = await fetch(payloadUrl, { method: "GET" });
      if (!res.ok) throw new Error(`下载数据失败：${res.status} ${res.statusText}`);
      const json = await res.json();
      const remoteEntries = (json?.entries ?? null) as Record<string, string> | null;
      if (!remoteEntries || typeof remoteEntries !== "object") throw new Error("同步数据格式不正确。");
      const result = applyIncrementalLanSyncImport(window.localStorage, remoteEntries);
      setImportResult(
        `已导入：新增关注 ${result.addedStreamers}，新增文件夹 ${result.addedFolderCount}，文件夹新增条目 ${result.addedFolderItems}，新增自定义分区 ${result.addedCustomCategories}。`
      );
    } catch (e) {
      setImportError(e instanceof Error ? e.message : String(e));
    } finally {
      setImportBusy(false);
    }
  }, [canUseStorage, discoveredBaseUrl, discoveredToken]);

  const copyFirstUrl = useCallback(async () => {
    const token = serverInfo?.token || lanToken || "dtv";
    const host = serverInfo?.hosts?.find((h) => h !== "localhost" && h !== "127.0.0.1") || "127.0.0.1";
    const url = `http://${host}:${serverInfo?.port || FIXED_PORT}/dtv-sync?token=${encodeURIComponent(token)}`;
    try {
      await navigator.clipboard.writeText(url);
      setExportError(null);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : String(e));
    }
  }, [lanToken, serverInfo]);

  const stopScan = useCallback(() => {
    scanAbortRef.current = true;
    const stream = scanStreamRef.current;
    scanStreamRef.current = null;
    if (stream) {
      try {
        stream.getTracks().forEach((t) => t.stop());
      } catch {
        // ignore
      }
    }
  }, []);

  const startScan = useCallback(async () => {
    setScanError(null);
    setScanBusy(true);
    scanAbortRef.current = false;
    try {
      const BD = (window as any).BarcodeDetector;
      if (!BD) throw new Error("当前环境不支持扫码（BarcodeDetector 不可用）。可使用“自动发现”或手动输入 URL。");
      const detector = new BD({ formats: ["qr_code"] });

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" }
      });
      scanStreamRef.current = stream;

      const video = document.getElementById("dtv-lan-scan-video") as HTMLVideoElement | null;
      if (!video) throw new Error("扫码组件初始化失败。");
      video.srcObject = stream;
      await video.play();

      const deadline = Date.now() + 45_000;
      while (Date.now() < deadline && !scanAbortRef.current) {
        // eslint-disable-next-line no-await-in-loop
        const codes = await detector.detect(video);
        const val = codes?.[0]?.rawValue;
        if (typeof val === "string" && val.trim()) {
          setManualTarget(val.trim());
          setScanOpen(false);
          break;
        }
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 120));
      }
      stopScan();
    } catch (e) {
      setScanError(e instanceof Error ? e.message : String(e));
      stopScan();
    } finally {
      setScanBusy(false);
    }
  }, [stopScan]);

  useEffect(() => {
    if (!scanOpen) {
      stopScan();
    }
  }, [scanOpen, stopScan]);

  const close = useCallback(() => {
    setManifest(null);
    setDiscoveredBaseUrl(null);
    setImportError(null);
    setImportResult(null);
    setExportError(null);
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
              <button
                type="button"
                className={`${styles.syncTab} ${tab === "export" ? styles.syncTabActive : ""}`}
                onClick={() => setTab("export")}
              >
                <Upload size={16} />
                导出共享
              </button>
              <button
                type="button"
                className={`${styles.syncTab} ${tab === "import" ? styles.syncTabActive : ""}`}
                onClick={() => setTab("import")}
              >
                <Download size={16} />
                导入
              </button>
            </div>

            {tab === "export" ? (
              <>
                <p className={styles.syncHint}>共享内容：关注列表 + 自定义分区订阅。固定端口 {FIXED_PORT}，接收端手动输入共享端 IP 导入（增量跳过重复）。</p>

                <div className={styles.syncMetaGrid} aria-label="local summary">
                  <div className={styles.syncMetaItem}>
                    <div className={styles.syncMetaKey}>本机关注</div>
                    <div className={styles.syncMetaVal}>{localSummary.followed}</div>
                  </div>
                  <div className={styles.syncMetaItem}>
                    <div className={styles.syncMetaKey}>本机文件夹</div>
                    <div className={styles.syncMetaVal}>{localSummary.folders}</div>
                  </div>
                  <div className={styles.syncMetaItem}>
                    <div className={styles.syncMetaKey}>本机自定义分区</div>
                    <div className={styles.syncMetaVal}>{localSummary.custom}</div>
                  </div>
                  <div className={styles.syncMetaItem}>
                    <div className={styles.syncMetaKey}>提示</div>
                    <div className={styles.syncMetaVal} style={{ fontSize: 12, fontWeight: 900 }}>
                      首次开启可能弹防火墙提示
                    </div>
                  </div>
                </div>

                {serverInfo?.hosts?.length ? (
                  <div className={styles.syncUrlList} aria-label="hosts">
                    <div className={styles.syncUrlItem}>
                      <div className={styles.syncUrlText}>共享端口：{serverInfo.port}</div>
                    </div>
                    <div className={styles.syncUrlItem}>
                      <div className={styles.syncUrlText}>本机 IP：{serverInfo.hosts.filter((h) => h !== "localhost" && h !== "127.0.0.1").join(" / ") || "未获取到"}</div>
                    </div>
                    <div className={styles.syncUrlItem}>
                      <div className={styles.syncUrlText}>导入链接：http://&lt;本机IP&gt;:{serverInfo.port}/dtv-sync?token=***</div>
                    </div>
                    {shareUrl ? (
                      <div className={styles.syncUrlItem} style={{ justifyContent: "space-between", alignItems: "center" }}>
                        <div className={styles.syncUrlText} style={{ flex: "0 0 auto" }}>
                          扫码导入
                        </div>
                        <div style={{ background: "#fff", padding: 8, borderRadius: 12 }}>
                          <QRCodeCanvas value={shareUrl} size={120} includeMargin />
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {exportError ? (
                  <p className={styles.syncHint} style={{ color: "rgba(239, 68, 68, 0.95)" }}>
                    {exportError}
                  </p>
                ) : null}

                <div className={styles.syncActionsRow}>
                  {serverInfo?.hosts?.length ? (
                    <>
                      <button type="button" className={styles.secondaryBtn} onClick={() => void copyFirstUrl()} disabled={exportBusy}>
                        复制导入链接
                      </button>
                      <button type="button" className={styles.dangerBtn} onClick={() => void stopShare()} disabled={exportBusy}>
                        停止共享
                      </button>
                    </>
                  ) : (
                    <button type="button" className={styles.primaryBtn} onClick={() => void startShare()} disabled={exportBusy || !canUseStorage}>
                      开始共享
                    </button>
                  )}
                </div>
              </>
            ) : (
              <>
                <p className={styles.syncHint}>支持一键发现（mDNS/Bonjour）或手动输入 URL/IP，先预览再确认导入（增量，不覆盖本地）。</p>

                <div className={styles.syncField}>
                  <div className={styles.syncLabel}>手动输入（URL 或 IP）</div>
                  <input
                    className={styles.syncInput}
                    value={manualTarget}
                    onChange={(e) => setManualTarget(e.target.value)}
                    placeholder={`例如：http://192.168.1.8:${FIXED_PORT}/dtv-sync?token=... 或 192.168.1.8`}
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                </div>

                {scanOpen ? (
                  <div className={styles.syncUrlList} aria-label="qr scanner">
                    <div className={styles.syncUrlItem} style={{ flexDirection: "column", alignItems: "stretch" }}>
                      <div className={styles.syncUrlText} style={{ marginBottom: 8 }}>
                        扫描二维码（若无法识别，请改用自动发现/手动输入）
                      </div>
                      <video
                        id="dtv-lan-scan-video"
                        muted
                        playsInline
                        style={{ width: "100%", height: 220, borderRadius: 12, background: "#000" }}
                      />
                      {scanError ? (
                        <div className={styles.syncHint} style={{ marginTop: 8, color: "rgba(239, 68, 68, 0.95)" }}>
                          {scanError}
                        </div>
                      ) : null}
                      <div className={styles.syncActionsRow} style={{ justifyContent: "flex-end" }}>
                        <button type="button" className={styles.secondaryBtn} onClick={() => setScanOpen(false)} disabled={scanBusy}>
                          关闭扫码
                        </button>
                        <button type="button" className={styles.primaryBtn} onClick={() => void startScan()} disabled={scanBusy}>
                          开始识别
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}

                {discoveredPeers.length ? (
                  <div className={styles.syncUrlList} aria-label="discovered peers">
                    {discoveredPeers.map((p) => (
                      <button
                        key={p.name}
                        type="button"
                        className={styles.syncUrlItem}
                        style={{ cursor: "pointer", opacity: selectedPeer?.name === p.name ? 1 : 0.72 }}
                        onClick={() => setSelectedPeer(p)}
                        disabled={importBusy}
                      >
                        <div className={styles.syncUrlText}>
                          {p.name}（{p.host}:{p.port}）
                        </div>
                      </button>
                    ))}
                  </div>
                ) : null}

                {manifest ? (
                  <div className={styles.syncMetaGrid} aria-label="remote preview">
                    <div className={styles.syncMetaItem}>
                      <div className={styles.syncMetaKey}>对方关注</div>
                      <div className={styles.syncMetaVal}>{manifest.summary.followedStreamers}</div>
                    </div>
                    <div className={styles.syncMetaItem}>
                      <div className={styles.syncMetaKey}>对方文件夹</div>
                      <div className={styles.syncMetaVal}>{manifest.summary.followFolders}</div>
                    </div>
                    <div className={styles.syncMetaItem}>
                      <div className={styles.syncMetaKey}>对方自定义分区</div>
                      <div className={styles.syncMetaVal}>{manifest.summary.customCategories}</div>
                    </div>
                    <div className={styles.syncMetaItem}>
                      <div className={styles.syncMetaKey}>导出时间</div>
                      <div className={styles.syncMetaVal} style={{ fontSize: 12, fontWeight: 900 }}>
                        {new Date(manifest.exportedAt).toLocaleString()}
                      </div>
                    </div>
                  </div>
                ) : null}

                {importError ? (
                  <p className={styles.syncHint} style={{ color: "rgba(239, 68, 68, 0.95)" }}>
                    {importError}
                  </p>
                ) : null}

                {importResult ? <p className={styles.syncHint}>{importResult}</p> : null}

                <div className={styles.syncActionsRow}>
                  <button type="button" className={styles.secondaryBtn} onClick={() => void discoverPeers()} disabled={importBusy}>
                    自动发现
                  </button>
                  <button type="button" className={styles.secondaryBtn} onClick={() => setScanOpen(true)} disabled={importBusy}>
                    扫码导入
                  </button>
                  <button type="button" className={styles.secondaryBtn} onClick={() => void fetchPreview()} disabled={importBusy}>
                    预览
                  </button>
                  <button type="button" className={styles.primaryBtn} onClick={() => void confirmImport()} disabled={importBusy || !manifest || !canUseStorage}>
                    确认导入
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
