use anyhow::Result;
use spin_sdk::{
    http::{IntoResponse, Params, Request, Router},
    http_component,
    key_value::Store,
};

pub mod http;
pub mod setup;

#[http_component]
fn handle(req: Request) -> anyhow::Result<impl IntoResponse> {
    setup::setup_tracing();

    let mut router = Router::new();
    router.get_async("/internal/kv-explorer/api/stores/:store", list_keys);
    router.get_async("/internal/kv-explorer/api/stores/:store/keys/*", get_key);
    router.post_async("/internal/kv-explorer/api/stores/:store/keys/*", set_key);
    router.delete_async("/internal/kv-explorer/api/stores/:store/keys/*", delete_key);

    Ok(router.handle(req))
}

/// GET /api/stores/:store → {"store": "...", "keys": ["k1", "k2", ...]}
async fn list_keys(_req: Request, params: Params) -> Result<impl IntoResponse> {
    let store_name = params.get("store").unwrap_or_default();
    tracing::info!("Listing keys in store: {store_name}");

    let store = Store::open(store_name)?;
    let keys = store.get_keys()?;

    #[derive(serde::Serialize)]
    struct ListResponse {
        store: String,
        keys: Vec<String>,
    }

    Ok(http::json_response(
        200,
        &ListResponse {
            store: store_name.to_string(),
            keys,
        },
    ))
}

/// GET /api/stores/:store/keys/{key} → raw bytes (application/octet-stream)
///
/// Returns the value as raw bytes — no JSON wrapping, no base64.
/// Binary in, binary out.
async fn get_key(req: Request, params: Params) -> Result<impl IntoResponse> {
    let store_name = params.get("store").unwrap_or_default();
    let key = extract_key(req.uri(), store_name);
    tracing::info!("Getting key: {key} from store: {store_name}");

    let store = Store::open(store_name)?;
    if !store.exists(&key)? {
        return Ok(http::error_response(404, "key not found"));
    }

    let value = store.get(&key)?.unwrap_or_default();

    Ok(spin_sdk::http::Response::builder()
        .status(200)
        .header("content-type", "application/octet-stream")
        .header("x-kv-key", &key)
        .header("x-kv-size", value.len().to_string())
        .body(value)
        .build())
}

/// POST /api/stores/:store/keys/{key} — raw bytes in body, stored as-is.
async fn set_key(req: Request, params: Params) -> Result<impl IntoResponse> {
    let store_name = params.get("store").unwrap_or_default();
    let key = extract_key(req.uri(), store_name);
    tracing::info!("Setting key: {key} in store: {store_name} ({} bytes)", req.body().len());

    let store = Store::open(store_name)?;
    store.set(&key, req.body())?;

    Ok(http::json_response(200, &serde_json::json!({ "ok": true })))
}

/// DELETE /api/stores/:store/keys/{key}
async fn delete_key(req: Request, params: Params) -> Result<impl IntoResponse> {
    let store_name = params.get("store").unwrap_or_default();
    let key = extract_key(req.uri(), store_name);
    tracing::info!("Deleting key: {key} from store: {store_name}");

    let store = Store::open(store_name)?;
    store.delete(&key)?;

    Ok(spin_sdk::http::Response::builder().status(200).body(()).build())
}

/// Extract the key from the URI path after /keys/.
/// The wildcard param doesn't decode, so we parse from the URI directly.
/// The URI may include the full route prefix (e.g. /internal/kv-explorer/api/stores/...)
/// or just the path-info portion (/api/stores/...).
fn extract_key(uri: &str, store_name: &str) -> String {
    let path = uri.split('?').next().unwrap_or(uri);
    let needle = format!("/stores/{store_name}/keys/");
    let raw = match path.find(&needle) {
        Some(pos) => &path[pos + needle.len()..],
        None => "",
    };
    url_decode(raw)
}

fn url_decode(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    let mut chars = s.bytes();
    while let Some(b) = chars.next() {
        if b == b'%' {
            if let (Some(h), Some(l)) = (chars.next(), chars.next()) {
                let hv = hex_val(h);
                let lv = hex_val(l);
                if let (Some(hv), Some(lv)) = (hv, lv) {
                    result.push((hv << 4 | lv) as char);
                    continue;
                }
            }
            result.push('%');
        } else if b == b'+' {
            result.push(' ');
        } else {
            result.push(b as char);
        }
    }
    result
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}
