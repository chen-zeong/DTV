import { Fragment, useMemo } from "react";
import type { LivePlatform } from "@/api";
import { splitEmoticons } from "@/lib/emoticons";
import styles from "./EmoticonText.module.css";

/**
 * 把弹幕正文渲染成「文字 + 表情图」。
 *
 * 直播间正文里的 `[看]` `[捂脸]` 在纯文本里是四个字符，直接显示很难看。
 * 这里按平台的官方表情包还原成图片，包外再退回 Unicode 表情，
 * 两级都没命中的保持原样（见 lib/emoticons.ts）。
 */
export function EmoticonText({
  text,
  platform,
}: {
  text: string;
  platform?: LivePlatform;
}) {
  const parts = useMemo(() => splitEmoticons(text, platform), [platform, text]);

  return (
    <>
      {parts.map((part, index) => {
        if (part.type === "text") {
          // 文本片段已经在解析时合并过，不会再按字切碎
          return <Fragment key={index}>{part.text}</Fragment>;
        }
        if (part.type === "emoji") {
          return <Fragment key={index}>{part.emoji}</Fragment>;
        }
        return (
          <img
            key={index}
            className={styles.emote}
            src={part.src}
            alt={part.name}
            title={`[${part.name}]`}
            draggable={false}
          />
        );
      })}
    </>
  );
}
