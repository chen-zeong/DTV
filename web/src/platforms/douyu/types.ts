// Douyu specific raw API response types for the frontend

/**
 * Raw structure for a single game category as returned by Douyu API.
 */
export interface DouyuRawGameCategory {
  cate_id: string;      // Category ID (Douyu might also use tag_id or other variations)
  game_name: string;    // Full name of the game/category
  short_name?: string;  // Short name (e.g., lol, dota2)
  game_url?: string;    // URL path segment for this category (e.g., /g_LOL)
  game_icon?: string;   // URL for category icon
  game_src?: string;    // URL for a larger banner/image for the category
  count?: number;       // Sometimes Douyu includes live stream count in category data
  is_child_cate?: number; // Indicator for sub-categories (e.g., 0 or 1)
  child_cates?: DouyuRawGameCategory[]; // For nested sub-categories, if API provides them directly
}

/**
 * Raw structure for a group of categories (e.g., "热门游戏", "网游竞技") from Douyu API.
 */
export interface DouyuRawCategoryGroup {
  tag_id: string;       // Group ID
  tag_name: string;     // Group name (e.g., "热门游戏")
  icon_url?: string;    // Optional icon for the group
  // Douyu API can be inconsistent with field names for the list of categories.
  // Common examples: list, cate_list, video_list, rl (room list, but sometimes for categories too)
  list: DouyuRawGameCategory[]; 
}

/**
 * Represents the `data` part of a successful API response for all categories.
 * The actual field containing the list of groups/categories can vary.
 */
export interface DouyuRawCategoriesResponseData {
  // Field name examples: gameList, cate_list, cateInfo, AllCateList. Adjust as per actual API.
  // Assuming the API returns an array of groups directly under a specific key.
  // If it's a flat list of categories, or a different structure, this needs to be adjusted.
  category_groups?: DouyuRawCategoryGroup[]; // If categories are grouped
  categories?: DouyuRawGameCategory[];     // Or if it's a flat list
  // Add other potential top-level fields from the `data` object if necessary.
}

/**
 * A common base response structure for many Douyu APIs.
 * @template T The type of the `data` field on success.
 */
export interface DouyuRawApiResponse<T> {
  error: number; // Typically 0 for success, non-zero for errors
  data?: T;      // Data payload, present if error is 0
  msg?: string;  // Optional error message
}


// --- Types related to fetching rooms within a specific category --- //

/**
 * Raw structure for a single room/streamer when listing rooms in a category.
 */
export interface DouyuRawRoomInCategory {
  room_id: string;
  room_name: string;      // Stream title
  nickname: string;       // Streamer's nickname
  owner_uid?: string;     // Streamer's user ID
  avatar_mid?: string;    // URL to streamer's medium avatar
  online: number;         // Current viewer count (ensure parsed as number)
  show_status: string;    // Stream status, typically "1" for live
  room_src?: string;      // URL to the stream's cover image/thumbnail
  category_name?: string; // Name of the category the stream belongs to
  cate_id?: string;       // ID of the category
  is_vertical?: number;   // Indicator if the stream is vertical (e.g., mobile game streaming)
  vertical_src?: string;  // Cover image for vertical streams
  // Potentially other fields like game_name, specific tags, etc.
}

/**
 * Represents the `data` part of a successful API response when fetching rooms in a category.
 */
export interface DouyuRawRoomsInCateListData {
  rl: DouyuRawRoomInCategory[]; // 'rl' is a common field name Douyu uses for room lists
  pgcnt?: number;             // Total page count for pagination
  ct?: number;                // Total count of items, or items on the current page
}


// --- Types related to fetching specific room/streamer information (already used by StreamerInfo) --- //

/**
 * Detailed information about the room owner (streamer).
 */
export interface DouyuRoomInfoOwner {
  nickname: string;
  avatar: string; // URL to owner's avatar
  // Potentially other details like owner_id, follower_count, etc.
}

/**
 * Represents the `room` object or the main data part of a room information API response.
 */
export interface DouyuRoomInfoData {
  room_id: string;
  room_name: string;         // Stream title
  show_status: string;       // Stream status, "1" for live
  nickname: string;          // Streamer's nickname (often the one displayed)
  owner_name?: string;        // Actual owner name, might differ from nickname
  avatar_mid?: string;        // URL to streamer's medium avatar (used for the room display)
  owner_avatar_mid?: string;  // URL to owner's actual avatar, can be different
  online_num: number | string; // Current viewer count (can be string, parse to number)
  cate_id: string;           // Category ID
  cate_name: string;         // Category name
  videoLoop: number | string;  // Indicates if it's a replay/video loop (e.g., 1 for loop, 0 for live)
  room_thumb: string;        // URL to room's thumbnail/cover image
  ownerDetail?: DouyuRoomInfoOwner; // Nested object with more detailed owner information (in some APIs)
}

export type DouyuRoomInfo = DouyuRoomInfoData; 