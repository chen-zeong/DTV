import type { SupportedPlatform } from "../app/platform";

export interface Category1 {
  title?: string;
  href?: string;
  subcategories?: Category2[];
  id?: string | number;
  cate1Id?: number; // Douyu specific
  cate1Name?: string; // Douyu specific
}

export interface Category2 {
  title?: string;
  href?: string;
  id?: string | number;
  gid?: string | number;
  parentId?: string | number;
  parent_id?: string | number;
  cate1Id?: number; // Douyu specific
  cate2Id?: number; // Douyu specific
  cate2Name?: string; // Douyu specific
  shortName?: string; // Douyu specific
  count?: number; // Douyu specific
  icon?: string; // Added missing property
}

export interface Category3 {
  id: string;
  name: string;
}

export interface CategorySelectedEvent {
  type: "cate2";
  cate1Href: string;
  cate2Href: string;
  cate1Name: string;
  cate2Name: string;
}

export interface CommonPlatformCategory {
  id: string;
  name: string;
  platform: SupportedPlatform;
  iconUrl?: string;
  parentId?: string;
}

export interface CommonCategoryGroup {
  groupName: string;
  platform: SupportedPlatform;
  categories: CommonPlatformCategory[];
}
