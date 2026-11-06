import {
  AlertCircle,
  CheckCircle2,
  Download,
  Loader2,
  MonitorSmartphone,
  RefreshCw,
  Share2,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { renderSVG } from "uqr";
import * as DataTransfer from "../../../bindings/dtv/internal/services/datatransferservice";
import * as LanSync from "../../../bindings/dtv/internal/services/lansyncservice";
import { cn } from "@/lib/cn";
import { APP_VERSION } from "@/lib/appInfo";
import {
  buildPortableConfigFileName,
  createPortableConfigPayload,
  importPortableConfig,
  parsePortableConfig,
} from "@/lib/configTransfer";
import {
  applyIncrementalLanSyncImport,
  createLanSyncPayload,
  formatImportResult,
  parseLanSyncManifest,
  parseLanSyncPayload,
  type LanSyncPeer,
} from "@/lib/lanSync";
import styles from "./LanSyncModal.module.css";

interface ServerInfo {
  port: number;
  hosts: string[];
  token: string;
  baseUrl: string;
  name: string;
}

type TabKey = "export" | "import";

/** 与老项目一致：固定端口 + 固定令牌，不再要求用户输入配对码。 */
const FIXED_PORT = 38999;
const DEFAULT_TOKEN = "dtv";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "未知错误");
}

/**
 * 从网卡列表里挑一个"最像局域网"的地址。
 *
 * 和旧项目同一套打分规则：优先 192.168 → 10 → 172.16~31 → CGNAT，
 * 排除 169.254（APIPA）与 198.18/19（基准测试网段）。
 */
function pickBestLanHost(hosts: string[]): string | null {
  const ips = (hosts || [])
    .map((host) => String(host || "").trim())
    .filter((host) => host && host !== "localhost" && host !== "127.0.0.1");

  const isApipa = (ip: string) => ip.startsWith("169.254.");
  const isBenchmark = (ip: string) => ip.startsWith("198.18.") || ip.startsWith("198.19.");
  const isCgnat = (ip: string) => {
    const match = /^100\.(\d{1,3})\./.exec(ip);
    if (!match) return false;
    const second = Number(match[1]);
    return Number.isFinite(second) && second >= 64 && second <= 127;
  };

  const score = (ip: string) => {
    if (isApipa(ip) || isBenchmark(ip)) return -1;
    if (ip.startsWith("192.168.")) return 100;
    if (ip.startsWith("10.")) return 90;
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) return 80;
    if (isCgnat(ip)) return 70;
    return 0;
  };

  const sorted = [...ips].sort((a, b) => score(b) - score(a) || a.localeCompare(b));
  return sorted.find((ip) => score(ip) > 0) ?? null;
}

/** 手动输入的地址 → origin（没有端口时补默认同步端口）。 */
function normalizeImportTarget(input: string): string {
  const raw = String(input || "").trim();
  if (!raw) throw new Error("请输入共享端 IP。");
  const withScheme = raw.includes("://") ? raw : `http://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error("共享端地址格式不正确。");
  }
  if (!url.port) url.port = String(FIXED_PORT);
  return url.origin;
}

/**
 * 顶栏的「数据同步」弹窗。
 *
 * 布局与功能对齐老 Tauri 版：导出 / 导入两个页签，
 *   - 导出：二维码 + IP/端口 + 「导出 JSON」/「开启共享·结束共享」
 *   - 导入：「一键导入」（自动发现 + 取最新快照）/「导入 JSON」，或手动填 IP 导入
 * 老项目用的是固定令牌，这里保持一致 —— 不再有配对码输入框。
 */
export function LanSyncModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<TabKey>("export");

  const [server, setServer] = useState<ServerInfo | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const [jsonBusy, setJsonBusy] = useState(false);
  const [jsonNotice, setJsonNotice] = useState<string | null>(null);
  const [jsonError, setJsonError] = useState<string | null>(null);

  const [manualTarget, setManualTarget] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /* 打开时同步一次状态：上一次可能已经开过共享。 */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const status = await LanSync.Status();
        if (!cancelled) setServer((status as ServerInfo | null) ?? null);
      } catch {
        if (!cancelled) setServer(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const bestHost = useMemo(
    () => (server && server.hosts?.length ? pickBestLanHost(server.hosts) : null),
    [server],
  );

  const sharePort = server?.port || FIXED_PORT;
  const shareToken = server?.token || DEFAULT_TOKEN;

  /** 二维码内容：共享端的 payload 地址（与老项目一致）。 */
  const shareUrl = useMemo(() => {
    if (!bestHost) return "";
    return `http://${bestHost}:${sharePort}/dtv-sync/payload?token=${encodeURIComponent(shareToken)}`;
  }, [bestHost, sharePort, shareToken]);

  const shareQr = useMemo(() => {
    if (!shareUrl) return "";
    try {
      return renderSVG(shareUrl, {
        ecc: "M",
        border: 2,
        pixelSize: 3,
        whiteColor: "#ffffff",
        blackColor: "#111111",
      });
    } catch {
      return "";
    }
  }, [shareUrl]);

  const startShare = useCallback(async () => {
    setExportBusy(true);
    setExportError(null);
    try {
      const payload = createLanSyncPayload(window.localStorage, {
        client: "desktop",
        appVersion: APP_VERSION,
      });
      const info = (await LanSync.StartServer(payload)) as ServerInfo | null;
      if (!info) throw new Error("共享服务没有返回连接信息");
      setServer(info);
    } catch (error) {
      setExportError(errorMessage(error));
    } finally {
      setExportBusy(false);
    }
  }, []);

  const stopShare = useCallback(async () => {
    setExportBusy(true);
    setExportError(null);
    try {
      await LanSync.StopServer();
      setServer(null);
    } catch (error) {
      setExportError(errorMessage(error));
    } finally {
      setExportBusy(false);
    }
  }, []);

  const exportJson = useCallback(async () => {
    setJsonBusy(true);
    setJsonError(null);
    setJsonNotice(null);
    try {
      const payload = createPortableConfigPayload(window.localStorage, {
        client: "desktop",
        appVersion: APP_VERSION,
      });
      const text = `${JSON.stringify(payload, null, 2)}\n`;
      const saved = await DataTransfer.SaveExportJSONFile(
        text,
        buildPortableConfigFileName(),
      );
      if (saved) setJsonNotice(`已导出：${saved.path}`);
    } catch (error) {
      setJsonError(errorMessage(error));
    } finally {
      setJsonBusy(false);
    }
  }, []);

  /** 一键导入：发现同一局域网里的共享端，挑导出时间最新的一份导入。 */
  const importFromPeers = useCallback(async () => {
    setImportBusy(true);
    setImportError(null);
    setImportResult(null);
    try {
      const peers = ((await LanSync.Discover(1800)) ?? []) as LanSyncPeer[];
      if (peers.length === 0) {
        throw new Error("未发现共享端：请先在另一台电脑点「开启共享」。");
      }

      const probes = await Promise.allSettled(
        peers.map(async (peer) => {
          if (!peer?.baseUrl) throw new Error("共享端地址为空");
          const token = peer.token || DEFAULT_TOKEN;
          const manifest = parseLanSyncManifest(
            await LanSync.FetchManifest(peer.baseUrl, token),
          );
          const exportedAt = Date.parse(manifest.exportedAt);
          return { peer, token, exportedAt: Number.isFinite(exportedAt) ? exportedAt : 0 };
        }),
      );

      const ready = probes
        .filter(
          (item): item is PromiseFulfilledResult<{
            peer: LanSyncPeer;
            token: string;
            exportedAt: number;
          }> => item.status === "fulfilled",
        )
        .map((item) => item.value);

      if (ready.length === 0) {
        throw new Error("找到了设备但读不到同步清单：请确认对方仍开着共享。");
      }

      ready.sort((a, b) => b.exportedAt - a.exportedAt);
      const best = ready[0];
      const payload = parseLanSyncPayload(
        await LanSync.FetchPayload(best.peer.baseUrl, best.token),
      );
      const result = applyIncrementalLanSyncImport(window.localStorage, payload.entries);
      setImportResult(
        `${formatImportResult(result)}（来自 ${best.peer.host}:${best.peer.port}）`,
      );
    } catch (error) {
      setImportError(errorMessage(error));
    } finally {
      setImportBusy(false);
    }
  }, []);

  const importFromManual = useCallback(async () => {
    setImportBusy(true);
    setImportError(null);
    setImportResult(null);
    try {
      const baseUrl = normalizeImportTarget(manualTarget);
      const payload = parseLanSyncPayload(
        await LanSync.FetchPayload(baseUrl, DEFAULT_TOKEN),
      );
      const result = applyIncrementalLanSyncImport(window.localStorage, payload.entries);
      setImportResult(formatImportResult(result));
    } catch (error) {
      setImportError(errorMessage(error));
    } finally {
      setImportBusy(false);
    }
  }, [manualTarget]);

  const importJson = useCallback(async () => {
    setImportBusy(true);
    setImportError(null);
    setImportResult(null);
    try {
      const picked = await DataTransfer.PickImportJSONFile();
      if (!picked) return;
      const text = (picked as { content: string }).content;
      // 兼容两种文件：老版的 LAN 快照，或可移植配置文件
      const result = text.includes("dtv-config")
        ? importPortableConfig(window.localStorage, parsePortableConfig(text))
        : applyIncrementalLanSyncImport(
            window.localStorage,
            parseLanSyncPayload(JSON.parse(text)).entries,
          );
      setImportResult(`${formatImportResult(result)}（来自 JSON 文件）`);
    } catch (error) {
      setImportError(errorMessage(error));
    } finally {
      setImportBusy(false);
    }
  }, []);

  return createPortal(
    <div className={styles.backdrop} onMouseDown={onClose}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label="数据同步"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className={styles.header}>
          <span className={styles.titleIcon} aria-hidden="true">
            <MonitorSmartphone size={17} strokeWidth={2.1} />
          </span>
          <div className={styles.titleText}>
            <h2 className={styles.title}>数据同步</h2>
            <p className={styles.subtitle}>
              同一局域网内同步关注、分组、订阅与弹幕设置
            </p>
          </div>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="关闭">
            <X size={16} strokeWidth={2.2} />
          </button>
        </header>

        <div className={styles.tabs}>
          <button
            type="button"
            className={cn(styles.tab, tab === "export" && styles.tabActive)}
            onClick={() => setTab("export")}
          >
            <Upload size={14} strokeWidth={2.2} />
            导出
          </button>
          <button
            type="button"
            className={cn(styles.tab, tab === "import" && styles.tabActive)}
            onClick={() => setTab("import")}
          >
            <Download size={14} strokeWidth={2.2} />
            导入
          </button>
        </div>

        <div className={styles.body}>
          {tab === "export" ? (
            <>
              {shareQr ? (
                <div className={styles.shareRow}>
                  <div
                    className={styles.qrBox}
                    // uqr 生成的是纯 SVG 字符串，无外部内容
                    dangerouslySetInnerHTML={{ __html: shareQr }}
                  />
                  <div className={styles.shareMeta}>
                    <span className={styles.pill}>
                      正在共享 · {server?.name ?? "本机"}
                    </span>
                    <div className={styles.metaGrid}>
                      <div className={styles.metaItem}>
                        <span className={styles.metaKey}>IP</span>
                        <span className={styles.metaValue}>{bestHost}</span>
                      </div>
                      <div className={styles.metaItem}>
                        <span className={styles.metaKey}>端口</span>
                        <span className={styles.metaValue}>{sharePort}</span>
                      </div>
                    </div>
                    <p className={styles.hint}>
                      另一台电脑打开「导入 → 一键导入」即可搜到本机。
                    </p>
                  </div>
                </div>
              ) : (
                <p className={styles.hint}>
                  开启后会在局域网内广播，不经过互联网，也不会修改正在分享的数据。
                </p>
              )}

              {exportError && (
                <p className={styles.errorText} role="alert">
                  <AlertCircle size={14} strokeWidth={2.2} />
                  {exportError}
                </p>
              )}

              <div className={styles.actionRow}>
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  onClick={() => void exportJson()}
                  disabled={jsonBusy}
                >
                  {jsonBusy ? (
                    <Loader2 size={14} className={styles.spin} />
                  ) : (
                    <Download size={14} strokeWidth={2.2} />
                  )}
                  导出 JSON
                </button>
                {server ? (
                  <button
                    type="button"
                    className={styles.dangerBtn}
                    onClick={() => void stopShare()}
                    disabled={exportBusy}
                  >
                    结束共享
                  </button>
                ) : (
                  <button
                    type="button"
                    className={styles.primaryBtn}
                    onClick={() => void startShare()}
                    disabled={exportBusy}
                  >
                    {exportBusy ? (
                      <Loader2 size={14} className={styles.spin} />
                    ) : (
                      <Share2 size={14} strokeWidth={2.2} />
                    )}
                    开启共享
                  </button>
                )}
              </div>

              {jsonError && (
                <p className={styles.errorText} role="alert">
                  <AlertCircle size={14} strokeWidth={2.2} />
                  {jsonError}
                </p>
              )}
              {jsonNotice && (
                <p className={styles.okText} role="status">
                  <CheckCircle2 size={14} strokeWidth={2.2} />
                  {jsonNotice}
                </p>
              )}
            </>
          ) : (
            <>
              <div className={styles.actionRow}>
                <button
                  type="button"
                  className={styles.primaryBtn}
                  onClick={() => void importFromPeers()}
                  disabled={importBusy}
                >
                  {importBusy ? (
                    <Loader2 size={14} className={styles.spin} />
                  ) : (
                    <RefreshCw size={14} strokeWidth={2.2} />
                  )}
                  一键导入
                </button>
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  onClick={() => void importJson()}
                  disabled={importBusy}
                >
                  <Download size={14} strokeWidth={2.2} />
                  导入 JSON
                </button>
              </div>

              <div className={styles.manualRow}>
                <input
                  className={styles.input}
                  value={manualTarget}
                  onChange={(event) => setManualTarget(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && manualTarget.trim() && !importBusy) {
                      void importFromManual();
                    }
                  }}
                  placeholder="共享端 IP，例如：192.168.1.8"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  aria-label="共享端地址"
                />
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  onClick={() => void importFromManual()}
                  disabled={!manualTarget.trim() || importBusy}
                >
                  导入
                </button>
              </div>

              {importError && (
                <p className={styles.errorText} role="alert">
                  <AlertCircle size={14} strokeWidth={2.2} />
                  {importError}
                </p>
              )}

              {importResult && (
                <div className={styles.resultRow} role="status">
                  <CheckCircle2 size={15} strokeWidth={2.2} className={styles.okIcon} />
                  <span className={styles.resultText}>{importResult}</span>
                  <button
                    type="button"
                    className={styles.secondaryBtn}
                    onClick={() => window.location.reload()}
                  >
                    刷新应用
                  </button>
                </div>
              )}

              <p className={styles.hint}>
                关注、分组和订阅采用增量合并；主题、Cookie、清晰度等偏好以导入文件为准。
              </p>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
