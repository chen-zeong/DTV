use serde::{Deserialize, Serialize};

// Enum mirroring TypeScript SupportedPlatform
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub enum SupportedPlatformRust {
    #[serde(rename = "douyu")]
    Douyu,
    #[serde(rename = "bilibili")]
    Bilibili,
    #[serde(rename = "douyin")]
    Douyin,
    #[serde(rename = "huya")]
    Huya,
}

// Struct mirroring TypeScript CommonPlatformCategory
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CommonPlatformCategoryRust {
    pub id: String, // Platform-specific category ID
    pub name: String,
    pub platform: SupportedPlatformRust,
    #[serde(rename = "iconUrl")]
    pub icon_url: Option<String>,
    #[serde(rename = "parentId")]
    pub parent_id: Option<String>, // Optional, if categories are hierarchical
                                   // Add any other common fields
}

// Struct mirroring TypeScript CommonCategoryGroup
#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CommonCategoryGroupRust {
    #[serde(rename = "groupName")]
    pub group_name: String,
    pub platform: SupportedPlatformRust,
    pub categories: Vec<CommonPlatformCategoryRust>,
}
