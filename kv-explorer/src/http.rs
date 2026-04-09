use spin_sdk::http::Response;

pub fn json_response(status: u16, body: &impl serde::Serialize) -> Response {
    let body = serde_json::to_vec(body).unwrap_or_default();
    Response::builder()
        .status(status)
        .header("content-type", "application/json")
        .body(body)
        .build()
}

pub fn error_response(status: u16, message: &str) -> Response {
    json_response(status, &serde_json::json!({ "error": message }))
}

pub fn plain_response(status: u16, body: &str) -> Response {
    Response::builder()
        .status(status)
        .header("content-type", "text/plain")
        .body(body)
        .build()
}
