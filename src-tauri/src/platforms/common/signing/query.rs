use std::borrow::Cow;

pub fn join_kv_pairs(pairs: impl IntoIterator<Item = (impl AsRef<str>, impl AsRef<str>)>) -> String {
    pairs
        .into_iter()
        .map(|(k, v)| format!("{}={}", k.as_ref(), v.as_ref()))
        .collect::<Vec<_>>()
        .join("&")
}

pub fn join_kv_pairs_urlencoded_sorted(
    mut pairs: Vec<(String, String)>,
) -> String {
    pairs.sort_by(|a, b| a.0.cmp(&b.0));
    pairs
        .into_iter()
        .map(|(k, v)| {
            let k_enc: Cow<'_, str> = urlencoding::encode(&k);
            let v_enc: Cow<'_, str> = urlencoding::encode(&v);
            format!("{}={}", k_enc, v_enc)
        })
        .collect::<Vec<_>>()
        .join("&")
}
