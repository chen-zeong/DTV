import { describe, expect, it, vi } from "vitest";
import type { DanmakuMessage } from "@/api";
import { DanmakuFeed } from "./danmakuFeed";
import { canFitScrollLane, computeLaneMetrics, isEmoteOnlyParts } from "./danmuCanvasEngine";

function makeMsg(id: string, kind: DanmakuMessage["kind"] = "chat", content = "hello"): DanmakuMessage {
  return {
    id,
    nickname: "tester",
    content,
    level: 1,
    kind,
    at: Date.now(),
  };
}

describe("DanmakuFeed", () => {
  it("dispatches chat messages immediately to chat subscribers without waiting for panel flush", () => {
    const feed = new DanmakuFeed();
    const received: string[] = [];
    feed.subscribeChat((msg) => received.push(msg.id));

    feed.push(makeMsg("1", "chat"));
    feed.push(makeMsg("2", "enter"));
    feed.push(makeMsg("3", "gift"));

    expect(received).toEqual(["1"]);
    expect(feed.getMessages()).toEqual([]);

    feed.flushNow();
    expect(feed.getMessages().map((m) => m.id)).toEqual(["1", "2", "3"]);
    feed.dispose();
  });

  it("caps stored panel messages at 300 and clears cleanly", () => {
    const feed = new DanmakuFeed();
    const clearSpy = vi.fn();
    feed.subscribeClear(clearSpy);

    for (let i = 0; i < 350; i += 1) {
      feed.push(makeMsg(String(i)));
    }
    feed.flushNow();
    expect(feed.getMessages()).toHaveLength(300);
    expect(feed.getMessages()[0]?.id).toBe("50");

    feed.clear();
    expect(feed.getMessages()).toHaveLength(0);
    expect(clearSpy).toHaveBeenCalledTimes(1);
    feed.dispose();
  });
});

describe("danmuCanvasEngine helpers", () => {
  it("prevents scroll lane overlap both at spawn and catch-up", () => {
    expect(canFitScrollLane(undefined, 1280, 150)).toBe(true);
    // 上一条还没完全进屏
    expect(canFitScrollLane({ x: 1200, width: 100, speed: 120 }, 1280, 120)).toBe(false);
    // 上一条已留出足够尾部间距，且速度不慢于新弹幕
    expect(canFitScrollLane({ x: 900, width: 100, speed: 150 }, 1280, 140)).toBe(true);
    // 新弹幕更快，但在上一条退出前不会追尾
    expect(canFitScrollLane({ x: 200, width: 100, speed: 100 }, 1280, 200)).toBe(true);
    // 新弹幕太快，会在上一条离开前追尾
    expect(canFitScrollLane({ x: 900, width: 100, speed: 100 }, 1280, 300)).toBe(false);
  });

  it("limits lanes in lowPerformance mode", () => {
    const normal = computeLaneMetrics(1080, 20, 1, false);
    const lowPerf = computeLaneMetrics(1080, 20, 1, true);
    expect(normal.laneCount).toBeGreaterThan(12);
    expect(lowPerf.laneCount).toBeLessThanOrEqual(12);
  });

  it("identifies emote-only parts", () => {
    expect(isEmoteOnlyParts([{ type: "image", name: "doge", src: "/x.png" }])).toBe(true);
    expect(isEmoteOnlyParts([{ type: "emoji", name: "赞", emoji: "👍" }])).toBe(true);
    expect(isEmoteOnlyParts([{ type: "text", text: "666" }])).toBe(false);
  });
});
