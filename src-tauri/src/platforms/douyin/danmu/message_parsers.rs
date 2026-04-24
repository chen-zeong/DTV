use super::gen::{ChatMessage, LikeMessage, MemberMessage, RoomStatsMessage}; // Updated to directly use types from gen
use crate::platforms::common::DanmakuFrontendPayload;
use log::debug;
use prost::Message as ProstMessage; // For .decode() // Use shared payload type

// Parser for ChatMessage
pub fn parse_chat_message(
    payload: &[u8],
    current_room_id: &str,
) -> Result<Option<DanmakuFrontendPayload>, Box<dyn std::error::Error + Send + Sync>> {
    match ChatMessage::decode(payload) {
        Ok(chat_msg) => {
            if let Some(user) = chat_msg.user {
                // 获取用户等级 (来自 demo)
                let user_level = user.pay_grade.as_ref().map(|pg| pg.level).unwrap_or(0);
                // 获取粉丝牌等级 (来自 demo)
                // 注意：demo中的 fans_club.data.level 路径，确保你的 proto 定义一致
                // 如果你的 User 结构体中 fans_club 直接是 FansClubData 类型，则不需要 .data
                // 假设 FansClub 结构体包含一个 Option<FansClubData> 类型的字段 data
                let fans_club_level = user
                    .fans_club
                    .as_ref()
                    .and_then(|fc| fc.data.as_ref()) // 如果 FansClub 直接是 FansClubData，则为 .map(|fc| fc.level)
                    .map(|fcd| fcd.level)
                    .unwrap_or(0);

                Ok(Some(DanmakuFrontendPayload {
                    room_id: current_room_id.to_string(), // Populate room_id
                    user: user.nick_name.clone(),
                    content: chat_msg.content.clone(),
                    user_level,
                    fans_club_level,
                    // r#type: "chat".to_string(),
                }))
            } else {
                // 对于没有用户信息的聊天消息 (例如系统消息)，也可能需要发送，但等级为0
                Ok(Some(DanmakuFrontendPayload {
                    room_id: current_room_id.to_string(), // Populate room_id
                    user: "系统".to_string(),             // Or some other placeholder
                    content: chat_msg.content.clone(),
                    user_level: 0,
                    fans_club_level: 0,
                }))
            }
        }
        Err(e) => {
            debug!("    [Douyin Danmaku] Failed to parse ChatMessage: {}", e);
            Err(Box::new(e) as Box<dyn std::error::Error + Send + Sync>)
        }
    }
}

// Demo 中此函数返回 Result<(), ...> 并且只打印，这里保持原有返回 Option<DanmakuFrontendPayload> 结构
// 如果不需要将进场消息发送到前端，可以保持返回 Ok(None)
#[allow(dead_code)] // ADDED to suppress warning
pub fn parse_member_message(
    payload: &[u8],
    _current_room_id: &str,
) -> Result<Option<DanmakuFrontendPayload>, Box<dyn std::error::Error + Send + Sync>> {
    match MemberMessage::decode(payload) {
        Ok(member_msg) => {
            if let Some(user) = member_msg.user {
                let user_level = user.pay_grade.as_ref().map(|pg| pg.level).unwrap_or(0);
                let fans_club_level = user
                    .fans_club
                    .as_ref()
                    .and_then(|fc| fc.data.as_ref())
                    .map(|fcd| fcd.level)
                    .unwrap_or(0);

                debug!(
                    "    [Douyin Danmaku] Member enter: [用户等级: {}][粉丝牌等级: {}]{}",
                    user_level, fans_club_level, user.nick_name
                );
                Ok(None) // 当前不发送到前端
            } else {
                debug!("    [Douyin Danmaku] MemberMessage without user details.");
                Ok(None)
            }
        }
        Err(e) => {
            debug!("    [Douyin Danmaku] Failed to parse MemberMessage: {}", e);
            Err(Box::new(e) as Box<dyn std::error::Error + Send + Sync>)
        }
    }
}

// Parser for LikeMessage (点赞消息)
// Demo 中此函数返回 Result<(), ...> 并且只打印
#[allow(dead_code)] // ADDED to suppress warning
pub fn parse_like_message(
    payload: &[u8],
    _current_room_id: &str,
) -> Result<Option<DanmakuFrontendPayload>, Box<dyn std::error::Error + Send + Sync>> {
    match LikeMessage::decode(payload) {
        Ok(like_msg) => {
            if let Some(user) = like_msg.user {
                debug!("    [Douyin Danmaku] Like: {} x{}", user.nick_name, like_msg.count);
            } else {
                debug!("    [Douyin Danmaku] Like: x{} (no user)", like_msg.count);
            }
            Ok(None) // 点赞消息通常不直接作为弹幕显示在列表
        }
        Err(e) => {
            debug!("    [Douyin Danmaku] Failed to parse LikeMessage: {}", e);
            Err(Box::new(e) as Box<dyn std::error::Error + Send + Sync>)
        }
    }
}

#[allow(dead_code)] // ADDED to suppress warning
pub fn parse_room_stats_message(
    payload: &[u8],
    _current_room_id: &str,
) -> Result<Option<DanmakuFrontendPayload>, Box<dyn std::error::Error + Send + Sync>> {
    match RoomStatsMessage::decode(payload) {
        Ok(stats_msg) => {
            debug!("    [Douyin Danmaku] RoomStats: {}", stats_msg.display_long);
            Ok(None) // 统计信息通常不作为普通弹幕显示
        }
        Err(e) => {
            debug!("    [Douyin Danmaku] Failed to parse RoomStatsMessage: {}", e);
            Err(Box::new(e) as Box<dyn std::error::Error + Send + Sync>)
        }
    }
}
