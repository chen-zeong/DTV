use reqwest::header::USER_AGENT;
use serde::{Deserialize, Serialize};
use tauri::command;
// Structs expected by the frontend
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FrontendCate3Item {
    id: String,   // cate3Id
    name: String, // cate3Name
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FrontendCate2Item {
    id: String,         // cate2Id
    name: String,       // cate2Name
    short_name: String, // shortName
    icon: String,       // icon
    #[serde(rename = "cate3List")]
    cate3_list: Vec<FrontendCate3Item>, // Will be empty from this fetch
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FrontendCate1Item {
    id: String,   // cate1Id
    name: String, // cate1Name
    #[serde(rename = "cate2List")]
    cate2_list: Vec<FrontendCate2Item>,
}

// This is what the command will return
#[derive(Debug, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct FrontendCategoryResponse {
    #[serde(rename = "cate1List")]
    cate1_list: Vec<FrontendCate1Item>,
}

// Structs for deserializing Douyu's m.douyu.com/api/cate/list response
// Based on provided list.json

#[derive(Deserialize, Debug, Clone)]
struct JsonCate1Item {
    #[serde(rename = "cate1Id")]
    id: i32,
    #[serde(rename = "cate1Name")]
    name: String,
    // #[serde(rename = "shortName")] // Removed as unused
    // short_name: String,
}

#[derive(Deserialize, Debug, Clone)]
struct JsonCate2Item {
    #[serde(rename = "cate1Id")]
    parent_id: i32, // To link with JsonCate1Item.id
    #[serde(rename = "cate2Id")]
    id: i32,
    #[serde(rename = "cate2Name")]
    name: String,
    #[serde(rename = "shortName")]
    short_name: String,
    icon: String, // Assuming this is the desired icon URL
                  // pic: Option<String>, // Available but not currently used
                  // small_icon: Option<String>, // Available but not currently used
                  // count: Option<i32>, // Available but not currently used
}

// Removed DouyuCate3ItemRaw as it's not in this API response

#[derive(Deserialize, Debug)]
struct DouyuCategoryDataRaw {
    #[serde(rename = "cate1Info")]
    cate1_info: Option<Vec<JsonCate1Item>>,
    #[serde(rename = "cate2Info")]
    cate2_info: Option<Vec<JsonCate2Item>>,
}

#[derive(Deserialize, Debug)]
struct DouyuCategoryApiResponse {
    #[serde(alias = "code")]
    error: i32, // Douyu uses 'code' for error status
    msg: Option<String>,
    data: Option<DouyuCategoryDataRaw>,
}

// Define the structure that will be returned to the frontend
#[derive(Debug, Serialize, Deserialize)]
pub struct CategoriesApiResponse {
    #[serde(rename = "cate1List")]
    cate1_list: Vec<FrontendCate1Item>,
}

// Helper structs for the transformation (intermediate step before common types)
#[derive(Debug, Clone)]
struct RawFrontendCate2Item {
    id: String,
    name: String,
    short_name: String,
    icon: String,
}
#[derive(Debug, Clone)]
struct RawFrontendCate1Item {
    id: String,
    name: String,
    cate2_list: Vec<RawFrontendCate2Item>,
}

// New transformation function from Raw types to Frontend types
fn transform_raw_to_frontend_items(
    raw_cate1_items: Vec<RawFrontendCate1Item>,
) -> Vec<FrontendCate1Item> {
    raw_cate1_items
        .into_iter()
        .map(|raw_c1_item| {
            let frontend_c2_list = raw_c1_item
                .cate2_list
                .into_iter()
                .map(|raw_c2_item| {
                    FrontendCate2Item {
                        id: raw_c2_item.id,
                        name: raw_c2_item.name,
                        short_name: raw_c2_item.short_name,
                        icon: raw_c2_item.icon,
                        cate3_list: Vec::new(), // Add empty cate3List as per FrontendCate2Item definition
                    }
                })
                .collect();

            FrontendCate1Item {
                id: raw_c1_item.id,
                name: raw_c1_item.name,
                cate2_list: frontend_c2_list,
            }
        })
        .collect()
}

#[command]
pub async fn fetch_categories() -> Result<CategoriesApiResponse, String> {
    log::info!("[API Command] fetch_categories called");
    match fetch_categories_douyu_raw().await {
        Ok(raw_data) => {
            let frontend_data = transform_raw_to_frontend_items(raw_data);
            Ok(CategoriesApiResponse {
                cate1_list: frontend_data,
            })
        }
        Err(e) => {
            log::error!("[API Command] Error in fetch_categories: {}", e);
            Err(e)
        }
    }
}

// Internal function to fetch and parse to the old frontend-specific structure
async fn fetch_categories_douyu_raw() -> Result<Vec<RawFrontendCate1Item>, String> {
    let client = reqwest::Client::builder()
        .no_proxy()
        .build()
        .map_err(|e| e.to_string())?;
    let url = "https://m.douyu.com/api/cate/list";

    let response = client
        .get(url)
        .header(USER_AGENT, "Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1")
        .send()
        .await;

    match response {
        Ok(res) => {
            if res.status().is_success() {
                let body_text = res
                    .text()
                    .await
                    .map_err(|e| format!("Failed to read response body: {}", e))?;
                match serde_json::from_str::<DouyuCategoryApiResponse>(&body_text) {
                    Ok(parsed_response) => {
                        if parsed_response.error == 0 {
                            if let Some(douyu_data) = parsed_response.data {
                                let mut cate1_list: Vec<RawFrontendCate1Item> = Vec::new();
                                let all_raw_c2_items = douyu_data.cate2_info.unwrap_or_default();

                                if let Some(raw_cate1_list) = douyu_data.cate1_info {
                                    for raw_c1_item in raw_cate1_list {
                                        let mut c1_specific_cate2_list: Vec<RawFrontendCate2Item> =
                                            Vec::new();
                                        for raw_c2_item in &all_raw_c2_items {
                                            if raw_c2_item.parent_id == raw_c1_item.id {
                                                c1_specific_cate2_list.push(RawFrontendCate2Item {
                                                    id: raw_c2_item.id.to_string(),
                                                    name: raw_c2_item.name.clone(),
                                                    short_name: raw_c2_item.short_name.clone(),
                                                    icon: raw_c2_item.icon.clone(),
                                                });
                                            }
                                        }
                                        //硬编码加入“娱乐天地”下的“一起看”分类
                                        if 2 == raw_c1_item.id {//娱乐天地 yl 2
                                            c1_specific_cate2_list.push(RawFrontendCate2Item {
                                                id: 208.to_string(),
                                                name: "一起看".to_string(),
                                                short_name: "yqk".to_string(),
                                                icon: "https://sta-op.douyucdn.cn/dycatr/7c723d30bfb4399be7592c9fa12026e3.png".to_string(),
                                            });
                                        }
                                        cate1_list.push(RawFrontendCate1Item {
                                            id: raw_c1_item.id.to_string(),
                                            name: raw_c1_item.name.clone(),
                                            cate2_list: c1_specific_cate2_list,
                                        });
                                    }
                                }
                                Ok(cate1_list)
                            } else {
                                Err(format!(
                                    "Data field is missing. Code: {}, Msg: {:?}",
                                    parsed_response.error, parsed_response.msg
                                ))
                            }
                        } else {
                            Err(format!(
                                "Category API error. Code: {}, Msg: {:?}",
                                parsed_response.error, parsed_response.msg
                            ))
                        }
                    }
                    Err(e) => Err(format!(
                        "Failed to parse category JSON: {}, Body: {}",
                        e, body_text
                    )),
                }
            } else {
                Err(format!("Failed to fetch categories: HTTP {}", res.status()))
            }
        }
        Err(e) => Err(format!("Error fetching categories: {}", e)),
    }
}
