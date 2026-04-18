"use client";

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import "./DanmuList.css";
import type { DanmakuMessage } from "@/components/player/types";

const BLOCK_KEYWORDS_STORAGE = "danmu_block_keywords";

function userColor(nickname: string | undefined) {
  if (!nickname) return "hsl(0, 0%, 75%)";
  let hash = 0;
  for (let i = 0; i < nickname.length; i++) {
    hash = nickname.charCodeAt(i) + ((hash << 5) - hash);
    hash |= 0;
  }
  const hue = ((hash % 360) + 360) % 360;
  return `hsl(${hue}, 70%, 75%)`;
}

function loadBlockedKeywords(): string[] {
  try {
    const raw = window.localStorage.getItem(BLOCK_KEYWORDS_STORAGE);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v) => typeof v === "string" && v.trim().length > 0);
  } catch {
    return [];
  }
}

function persistBlockedKeywords(list: string[]) {
  try {
    window.localStorage.setItem(BLOCK_KEYWORDS_STORAGE, JSON.stringify(list));
  } catch {
    // ignore
  }
}

export function DanmuList({
  roomId,
  messages,
  actions
}: {
  roomId: string | null;
  messages: DanmakuMessage[];
  actions?: React.ReactNode;
}) {
  const listEl = useRef<HTMLDivElement | null>(null);
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [keywordInput, setKeywordInput] = useState("");
  const [blockedKeywords, setBlockedKeywords] = useState<string[]>([]);
  const scrollRafRef = useRef(0);

  useEffect(() => {
    setBlockedKeywords(loadBlockedKeywords());
  }, []);

  const filtered = useMemo(() => {
    if (!blockedKeywords.length) return messages;
    const kws = blockedKeywords.map((k) => k.toLowerCase());
    return messages.filter((m) => {
      if (m.isSystem) return true;
      const content = (m.content || "").toLowerCase();
      return !kws.some((kw) => content.includes(kw));
    });
  }, [blockedKeywords, messages]);

  const renderMessages = useMemo(() => {
    const max = 200;
    if (filtered.length <= max) return filtered;
    return filtered.slice(-max);
  }, [filtered]);

  const forceScrollToBottom = () => {
    const el = listEl.current;
    if (!el) return;
    if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = 0;
      el.scrollTop = el.scrollHeight;
    });
  };

  useLayoutEffect(() => {
    forceScrollToBottom();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderMessages.length, roomId, showFilterPanel]);

  useEffect(() => {
    return () => {
      if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
      scrollRafRef.current = 0;
    };
  }, []);

  const addKeyword = () => {
    const kw = keywordInput.trim();
    if (!kw) return;
    if (blockedKeywords.some((k) => k.toLowerCase() === kw.toLowerCase())) {
      setKeywordInput("");
      return;
    }
    const next = [...blockedKeywords, kw];
    setBlockedKeywords(next);
    persistBlockedKeywords(next);
    setKeywordInput("");
  };

  const removeKeyword = (idx: number) => {
    if (idx < 0 || idx >= blockedKeywords.length) return;
    const next = blockedKeywords.filter((_, i) => i !== idx);
    setBlockedKeywords(next);
    persistBlockedKeywords(next);
  };

  const copyDanmaku = async (m: DanmakuMessage) => {
    try {
      await navigator.clipboard.writeText(m.content || "");
    } catch {
      // ignore
    }
  };

  return (
    <div className="danmu-list-wrapper">
      <div className="danmu-actions-slot">
        {actions}
        <button
          type="button"
          className="panel-close"
          title="屏蔽关键词"
          onClick={() => setShowFilterPanel((v) => !v)}
        >
          滤
        </button>
      </div>

      {showFilterPanel ? (
        <div className="danmu-filter-panel" onPointerDown={(e) => e.stopPropagation()}>
          <div className="panel-header">
            <span className="panel-title">屏蔽关键词</span>
            <button className="panel-close" type="button" onClick={() => setShowFilterPanel(false)} title="关闭">
              ×
            </button>
          </div>
          <div className="panel-body">
            <input
              className="panel-input"
              type="text"
              placeholder="输入关键词回车添加"
              value={keywordInput}
              onChange={(e) => setKeywordInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addKeyword();
                }
              }}
            />
            <div className="panel-list">
              {blockedKeywords.length === 0 ? <div className="panel-empty">暂无屏蔽词</div> : null}
              {blockedKeywords.map((kw, i) => (
                <div key={`${kw}-${i}`} className="panel-item">
                  <span className="panel-item-text">{kw}</span>
                  <button className="panel-remove" type="button" onClick={() => removeKeyword(i)}>
                    删除
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      <div
        className="danmu-messages-area"
        ref={listEl}
      >
        {renderMessages.length === 0 ? (
          <div className="empty-danmu-placeholder">
            <p>{roomId ? "暂无弹幕或连接中..." : "请先选择一个直播间"}</p>
          </div>
        ) : null}

        {renderMessages.map((m, idx) => (
          <div
            key={m.id || `${m.room_id || ""}-${m.nickname}-${m.content}-${idx}`}
            className={`danmu-item ${m.isSystem ? "system-message" : ""}`}
            onClick={() => copyDanmaku(m)}
            title="点击复制弹幕"
          >
            {!m.isSystem ? (
              <div className="danmu-meta-line">
                <span className="danmu-user" style={{ color: m.color || userColor(m.nickname) }}>
                  {m.level ? <span style={{ opacity: 0.8 }}>[Lv.{m.level}] </span> : null}
                  {m.nickname}
                </span>
              </div>
            ) : null}
            <div className="danmu-content-line">{m.content}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
