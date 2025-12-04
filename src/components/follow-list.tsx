"use client";

import { Plus, RefreshCw } from "lucide-react";
import Image from "next/image";
import { ThemeMode } from "@/types/follow-list";
import { Platform } from "@/types/platform";
import { useFollowStore } from "@/stores/follow-store";
import { useMemo } from "react";
import { cn } from "@/utils/cn";
import { platformLabelMap, platformSlugMap } from "@/utils/platform";
import { useRouter } from "next/navigation";
import { SearchPanel } from "@/components/search/search-panel";

type FollowListProps = {
  theme: ThemeMode;
  searchPlatform: Platform;
};

const platformOrder: Array<Platform> = [Platform.DOUYU, Platform.HUYA, Platform.BILIBILI, Platform.DOUYIN];

const platformStyle: Record<
  Platform,
  {
    color: string;
    label: string;
  }
> = {
  [Platform.DOUYU]: { color: "border-orange-500/60 text-orange-300", label: "斗鱼" },
  [Platform.HUYA]: { color: "border-amber-400/70 text-amber-200", label: "虎牙" },
  [Platform.BILIBILI]: { color: "border-pink-400/60 text-pink-200", label: "哔哩" },
  [Platform.DOUYIN]: { color: "border-purple-400/60 text-purple-200", label: "抖音" },
};

export function FollowList({ theme, searchPlatform }: FollowListProps) {
  const isDark = theme === "dark";
  const follows = useFollowStore((s) => s.followedStreamers);
  const folders = useFollowStore((s) => s.folders);
  const createFolder = useFollowStore((s) => s.createFolder);
  const hydrate = useFollowStore((s) => s.hydrateFromLegacy);
  const moveToFolder = useFollowStore((s) => s.moveStreamerToFolder);
  const removeFromFolder = useFollowStore((s) => s.removeStreamerFromFolder);
  const deleteFolder = useFollowStore((s) => s.deleteFolder);
  const router = useRouter();
  const glassClass = isDark
    ? "bg-[rgba(20,20,20,0.65)] border-r border-[rgba(255,255,255,0.08)] text-white"
    : "bg-[rgba(255,255,255,0.85)] border-r border-[rgba(0,0,0,0.05)] text-gray-900";

  const backdropBlur = "backdrop-blur-[24px]";

  const sectionTitleClass = isDark ? "text-gray-200" : "text-gray-600";

  const grouped = useMemo(() => {
    const groups = platformOrder.map((platform) => ({
      platform,
      items: follows.filter((f) => f.platform === platform),
    }));
    return groups.filter((g) => g.items.length > 0);
  }, [follows]);

  const folderMap = useMemo(() => {
    const map = new Map<string, typeof follows[number]>();
    follows.forEach((f) => map.set(`${f.platform}:${f.id}`, f));
    return map;
  }, [follows]);

  const emptyState = grouped.length === 0;

  return (
    <div className={`w-[280px] h-full flex flex-col relative z-40 ${glassClass} ${backdropBlur} transition-colors duration-300`}>
      <div className="px-5 pb-4 pt-4">
        <SearchPanel platform={searchPlatform} />
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar px-2.5 pt-2 space-y-8 pb-20">
        <div className="space-y-3">
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={() => hydrate()}
              className="p-2 rounded-full border border-white/15 bg-white/5 hover:bg-white/10 transition-colors text-xs"
              title="刷新"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <button
              onClick={() => createFolder("新建文件夹")}
              className="p-2 rounded-full border border-white/15 bg-white/5 hover:bg-white/10 transition-colors text-xs"
              title="新建文件夹"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
          {folders.length > 0 && (
            <div className="space-y-3">
              {folders.map((folder) => {
                const items = (folder.streamerIds || [])
                  .map((id) => folderMap.get(id))
                  .filter((v): v is typeof follows[number] => Boolean(v));
                return (
                  <div
                    key={folder.id}
                    className={`rounded-xl border p-3 ${isDark ? "border-white/10 bg-white/5" : "border-black/10 bg-white"}`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-sm font-semibold">{folder.name}</div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => deleteFolder(folder.id)}
                          className="text-[11px] px-2 py-1 rounded-full border border-red-400/50 text-red-200 hover:bg-red-500/10 transition-colors"
                        >
                          删除
                        </button>
                      </div>
                    </div>
                    {items.length === 0 ? null : (
                      <div className="space-y-2">
                        {items.map((item) => (
                          <div
                            key={`${item.platform}-${item.id}`}
                            className={`flex items-center justify-between py-2 px-2 rounded-lg ${
                              isDark ? "bg-white/5" : "bg-black/5"
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <Image
                                src={item.avatarUrl || ""}
                                alt={item.nickname}
                                width={32}
                                height={32}
                                className="rounded-full object-cover w-8 h-8 border border-white/10"
                              />
                              <div className="flex flex-col">
                                <span className="text-sm">{item.displayName || item.nickname}</span>
                                <span className="text-xs text-gray-400">{platformLabelMap[item.platform]}</span>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                className="text-[11px] px-3 py-1 rounded-full border border-white/20 hover:bg-white/10"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  removeFromFolder(`${item.platform}:${item.id}`, folder.id);
                                }}
                              >
                                移出
                              </button>
                              <button
                                className="text-[11px] px-3 py-1 rounded-full border border-white/20 hover:bg-white/10"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const slug = platformSlugMap[item.platform];
                                  router.push(`/player?platform=${slug}&roomId=${item.id}`);
                                }}
                              >
                                播放
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {emptyState ? (
          <div className="mt-10 text-center text-sm text-gray-400">
            <p>暂无关注主播</p>
            <p className="text-xs mt-1 text-gray-500">在首页关注后会出现在这里</p>
          </div>
        ) : (
          grouped.map((section) => (
            <div key={section.platform} className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className={`text-sm font-medium flex items-center gap-2 ${sectionTitleClass}`}>
                  <button
                    className={cn(
                      "inline-flex items-center justify-center rounded-full border px-2 py-[2px] text-[11px] font-semibold",
                      platformStyle[section.platform].color
                    )}
                    onClick={() => router.push(`/${platformSlugMap[section.platform]}`)}
                  >
                    {platformLabelMap[section.platform]}
                  </button>
                </h2>
              </div>

              <div className="flex flex-col gap-2">
                {section.items.map((item) => (
                  <div
                    key={`${item.platform}-${item.id}`}
                    className={`flex items-center justify-between py-3 group rounded-lg px-3 transition-colors ${
                      isDark ? "hover:bg-white/5" : "hover:bg-black/5"
                    }`}
                    onClick={() => {
                      const slug = platformSlugMap[item.platform];
                      router.push(`/player?platform=${slug}&roomId=${item.id}`);
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        {item.avatarUrl ? (
                          <Image
                            src={item.avatarUrl}
                            alt={item.nickname}
                            width={40}
                            height={40}
                            sizes="40px"
                            className={`w-10 h-10 rounded-full object-cover border ${isDark ? "border-white/10" : "border-black/5"}`}
                          />
                        ) : (
                          <div
                            className={`w-10 h-10 rounded-full flex items-center justify-center text-xs font-semibold uppercase ${
                              isDark ? "bg-white/10 text-white" : "bg-black/5 text-gray-800"
                            }`}
                          >
                            {item.nickname?.slice(0, 1) || "?"}
                          </div>
                        )}
                      </div>

                      <div className="flex flex-col">
                        <span
                          className={`text-sm font-semibold leading-tight ${isDark ? "text-white" : "text-gray-900"} line-clamp-1`}
                          title={item.displayName || item.nickname}
                        >
                          {item.displayName || item.nickname}
                        </span>
                        <span
                          className={`text-xs leading-tight ${isDark ? "text-gray-400" : "text-gray-500"} line-clamp-1`}
                          title={item.nickname}
                        >
                          {item.nickname}
                        </span>
                        {item.roomTitle ? (
                          <span
                            className={`text-[11px] leading-tight ${isDark ? "text-gray-400" : "text-gray-500"} line-clamp-1`}
                            title={item.roomTitle}
                          >
                            {item.roomTitle}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      {folders.length > 0 && (
                        <select
                          className="text-[11px] px-2 py-1 rounded-full border border-white/20 bg-transparent"
                          defaultValue=""
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            const folderId = e.target.value;
                            if (!folderId) return;
                            moveToFolder(`${item.platform}:${item.id}`, folderId);
                            e.currentTarget.value = "";
                          }}
                        >
                          <option value="">移入文件夹</option>
                          {folders.map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
