import { useCallback, useEffect, useMemo, useState } from "react";
import {
  isDanmuBlocked,
  loadDanmuBlockKeywords,
  normalizeDanmuBlockKeywords,
  saveDanmuBlockKeywords,
} from "./danmuSettings";

/**
 * 弹幕屏蔽关键词（对齐老项目 DanmuKeywordBlockControl 的行为）。
 *
 * 关键词对所有平台生效，存在 localStorage 的 `danmu_block_keywords` 里
 * （键名与老 Tauri 版一致），匹配规则是不区分大小写的"包含"。
 */
export function useDanmuBlock() {
  const [keywords, setKeywords] = useState<string[]>(loadDanmuBlockKeywords);

  useEffect(() => {
    saveDanmuBlockKeywords(keywords);
  }, [keywords]);

  /** 小写化后的关键词，给每条弹幕匹配用 */
  const keywordsLower = useMemo(
    () => keywords.map((keyword) => keyword.toLowerCase()).filter(Boolean),
    [keywords],
  );

  const addKeyword = useCallback((raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return false;
    let added = false;
    setKeywords((prev) => {
      const next = normalizeDanmuBlockKeywords([...prev, trimmed]);
      added = next.length > prev.length;
      return next;
    });
    return added;
  }, []);

  const removeKeyword = useCallback((keyword: string) => {
    setKeywords((prev) => prev.filter((item) => item !== keyword));
  }, []);

  const clearKeywords = useCallback(() => setKeywords([]), []);

  const isBlocked = useCallback(
    (content: string) => isDanmuBlocked(content, keywordsLower),
    [keywordsLower],
  );

  return { keywords, keywordsLower, addKeyword, removeKeyword, clearKeywords, isBlocked };
}
