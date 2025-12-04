export type ThemeMode = "dark" | "light";

export interface User {
  rank: number;
  name: string;
  handle: string;
  avatarUrl: string;
  isVerified: boolean;
}

export interface LeaderboardItemData extends User {
  actionType: "cast" | "image" | "follow";
  actionImage?: string;
}

export interface SectionData {
  title: string;
  items: LeaderboardItemData[];
  hasSeeAll?: boolean;
}
