//! Self-hosted server selection: URL validation, instance discovery, config
//! persistence and start-URL resolution. Pure (no Tauri runtime) so it can be
//! unit tested with `cargo test`.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::time::Duration;
use tauri::Url;

pub const CONFIG_FILE: &str = "server.json";
/// Marker written by "Change server..."; makes the next launch show the setup
/// screen once while keeping the saved server for "Cancel".
pub const CHANGE_FLAG_FILE: &str = "change-server";

/// What we persist: everything needed to start without asking again.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ServerConfig {
    pub app_url: String,
    pub api_url: String,
    pub desktop_scheme: String,
}

/// Response of `GET <APP_URL>/api/instance` on the dashboard.
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct InstanceInfo {
    pub app_url: String,
    pub api_url: String,
    pub desktop_scheme: String,
    #[allow(dead_code)]
    pub version: String,
}

#[derive(Debug, PartialEq, Eq)]
pub enum StartTarget {
    /// Load the configured dashboard.
    Server(String),
    /// Show the local first-run / change-server screen.
    Setup,
}

fn is_local_host(host: &str) -> bool {
    host == "localhost"
        || host.ends_with(".localhost")
        || host == "127.0.0.1"
        || host == "[::1]"
}

/// Turn user input ("example.com", "localhost:3001/", "https://x.y/path") into
/// an origin string without trailing slash. Bare hosts default to https, except
/// local development hosts which default to http.
pub fn normalize_server_url(input: &str) -> Result<String, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("Enter the URL of your Midday dashboard".to_string());
    }

    let with_scheme = if trimmed.contains("://") {
        trimmed.to_string()
    } else {
        let host = trimmed
            .split(['/', '?', '#'])
            .next()
            .unwrap_or(trimmed)
            .rsplit('@')
            .next()
            .unwrap_or(trimmed);
        let hostname = host.rsplit_once(':').map(|(h, _)| h).unwrap_or(host);
        if is_local_host(hostname) {
            format!("http://{trimmed}")
        } else {
            format!("https://{trimmed}")
        }
    };

    let url = Url::parse(&with_scheme).map_err(|e| format!("Invalid URL: {e}"))?;
    if url.scheme() != "http" && url.scheme() != "https" {
        return Err("The URL must start with http:// or https://".to_string());
    }
    if url.host_str().is_none() {
        return Err("The URL has no host".to_string());
    }
    Ok(url.origin().ascii_serialization())
}

/// Build the config to persist from what the instance endpoint reported.
/// The reported URLs are authoritative: auth cookies are bound to APP_URL and
/// API_URL, so the app must load exactly those, not whatever was typed.
pub fn config_from_instance(info: InstanceInfo) -> Result<ServerConfig, String> {
    let app_url = normalize_server_url(&info.app_url)?;
    let api_url = normalize_server_url(&info.api_url)?;
    if info.desktop_scheme.trim().is_empty() {
        return Err("The server did not report a desktop scheme".to_string());
    }
    Ok(ServerConfig {
        app_url,
        api_url,
        desktop_scheme: info.desktop_scheme,
    })
}

/// Fetch `<origin>/api/instance` and turn it into a config.
pub async fn discover(entered: &str) -> Result<ServerConfig, String> {
    let origin = normalize_server_url(entered)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .get(format!("{origin}/api/instance"))
        .send()
        .await
        .map_err(|e| format!("Could not reach {origin}: {e}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "{origin} did not look like a Midday dashboard (HTTP {})",
            response.status().as_u16()
        ));
    }
    let info = response
        .json::<InstanceInfo>()
        .await
        .map_err(|_| format!("{origin} did not look like a Midday dashboard"))?;
    config_from_instance(info)
}

pub fn load_config(dir: &Path) -> Option<ServerConfig> {
    let raw = fs::read_to_string(dir.join(CONFIG_FILE)).ok()?;
    serde_json::from_str(&raw).ok()
}

pub fn save_config(dir: &Path, config: &ServerConfig) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let raw = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    fs::write(dir.join(CONFIG_FILE), raw).map_err(|e| e.to_string())
}

pub fn request_change(dir: &Path) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    fs::write(dir.join(CHANGE_FLAG_FILE), "").map_err(|e| e.to_string())
}

/// Consume the change-server marker. Returns whether it was present.
pub fn take_change_request(dir: &Path) -> bool {
    fs::remove_file(dir.join(CHANGE_FLAG_FILE)).is_ok()
}

pub fn resolve_start(config: Option<&ServerConfig>, change_requested: bool) -> StartTarget {
    match config {
        Some(config) if !change_requested => StartTarget::Server(config.app_url.clone()),
        _ => StartTarget::Setup,
    }
}

/// Origins the main webview may stay on: the dashboard and the API.
pub fn allowed_origins(config: &ServerConfig) -> Vec<String> {
    vec![config.app_url.clone(), config.api_url.clone()]
}

/// True when navigating to `url` should leave the app (open in the system
/// browser). Non-http(s) schemes (tauri://, about:, ...) are never external.
pub fn is_external_url(url: &str, allowed: &[String]) -> bool {
    let Ok(target) = Url::parse(url) else {
        return false;
    };
    if target.scheme() != "http" && target.scheme() != "https" {
        return false;
    }
    let origin = target.origin().ascii_serialization();
    !allowed.iter().any(|allowed| *allowed == origin)
}

/// Runtime capability granting the app's IPC to the configured origins only.
/// Derived from the static local capability so permissions are defined once.
pub fn remote_capability(base: &str, config: &ServerConfig) -> Result<serde_json::Value, String> {
    let mut capability: serde_json::Value =
        serde_json::from_str(base).map_err(|e| e.to_string())?;
    let urls: Vec<String> = allowed_origins(config)
        .into_iter()
        .map(|origin| format!("{origin}/**"))
        .collect();
    capability["identifier"] = "remote-server".into();
    capability["description"] = "IPC access for the configured Midday server".into();
    capability["remote"] = serde_json::json!({ "urls": urls });
    capability["local"] = false.into();
    if let Some(obj) = capability.as_object_mut() {
        obj.remove("$schema");
    }
    Ok(capability)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg() -> ServerConfig {
        ServerConfig {
            app_url: "https://app.example.com".into(),
            api_url: "https://api.example.com".into(),
            desktop_scheme: "midday".into(),
        }
    }

    #[test]
    fn normalizes_user_input() {
        assert_eq!(normalize_server_url("app.example.com").unwrap(), "https://app.example.com");
        assert_eq!(normalize_server_url("  https://app.example.com/dash?x=1 ").unwrap(), "https://app.example.com");
        assert_eq!(normalize_server_url("localhost:3550").unwrap(), "http://localhost:3550");
        assert_eq!(normalize_server_url("midday.localhost").unwrap(), "http://midday.localhost");
        assert_eq!(normalize_server_url("http://192.168.1.5:3001/").unwrap(), "http://192.168.1.5:3001");
        assert_eq!(normalize_server_url("https://a.com:443").unwrap(), "https://a.com");
    }

    #[test]
    fn rejects_bad_input() {
        assert!(normalize_server_url("").is_err());
        assert!(normalize_server_url("   ").is_err());
        assert!(normalize_server_url("ftp://example.com").is_err());
        assert!(normalize_server_url("javascript:alert(1)").is_err());
    }

    #[test]
    fn instance_info_becomes_config() {
        let info: InstanceInfo = serde_json::from_str(
            r#"{"appUrl":"http://localhost:3550/","apiUrl":"http://localhost:3450","desktopScheme":"midday","version":"dev"}"#,
        )
        .unwrap();
        let config = config_from_instance(info).unwrap();
        assert_eq!(config.app_url, "http://localhost:3550");
        assert_eq!(config.api_url, "http://localhost:3450");
        assert_eq!(config.desktop_scheme, "midday");

        let bad = InstanceInfo { app_url: "x://y".into(), api_url: "https://a.com".into(), desktop_scheme: "m".into(), version: "1".into() };
        assert!(config_from_instance(bad).is_err());
        let no_scheme = InstanceInfo { app_url: "https://a.com".into(), api_url: "https://b.com".into(), desktop_scheme: " ".into(), version: "1".into() };
        assert!(config_from_instance(no_scheme).is_err());
    }

    #[test]
    fn config_round_trips_on_disk() {
        let dir = std::env::temp_dir().join(format!("midday-server-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        assert_eq!(load_config(&dir), None);
        save_config(&dir, &cfg()).unwrap();
        assert_eq!(load_config(&dir), Some(cfg()));

        // Corrupt file is treated as unconfigured.
        fs::write(dir.join(CONFIG_FILE), "{nope").unwrap();
        assert_eq!(load_config(&dir), None);

        assert!(!take_change_request(&dir));
        request_change(&dir).unwrap();
        assert!(take_change_request(&dir));
        assert!(!take_change_request(&dir));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn start_url_uses_configured_server() {
        assert_eq!(resolve_start(None, false), StartTarget::Setup);
        assert_eq!(resolve_start(Some(&cfg()), false), StartTarget::Server("https://app.example.com".into()));
        assert_eq!(resolve_start(Some(&cfg()), true), StartTarget::Setup);
    }

    #[test]
    fn external_navigation_is_decided_by_origin() {
        let allowed = allowed_origins(&cfg());
        assert!(!is_external_url("https://app.example.com/transactions?x=1", &allowed));
        assert!(!is_external_url("https://api.example.com/auth/callback", &allowed));
        assert!(is_external_url("https://evil.example.com/", &allowed));
        // same host, different scheme/port is a different origin
        assert!(is_external_url("http://app.example.com/", &allowed));
        assert!(is_external_url("https://app.example.com:8443/", &allowed));
        assert!(!is_external_url("tauri://localhost/index.html", &allowed));
        assert!(!is_external_url("about:blank", &allowed));
    }

    #[test]
    fn remote_capability_is_scoped_to_configured_origins() {
        let base = r#"{"$schema":"x","identifier":"default","windows":["main"],"permissions":["core:default"],"remote":{"urls":["https://x/**"]}}"#;
        let cap = remote_capability(base, &cfg()).unwrap();
        assert_eq!(cap["identifier"], "remote-server");
        assert_eq!(cap["local"], false);
        assert_eq!(cap["remote"]["urls"], serde_json::json!(["https://app.example.com/**", "https://api.example.com/**"]));
        assert_eq!(cap["permissions"][0], "core:default");
    }

    #[test]
    fn runtime_capability_parses_as_a_tauri_capability() {
        let base = include_str!("../capabilities/default.json");
        let cap = remote_capability(base, &cfg()).unwrap();
        let parsed: tauri::utils::acl::capability::CapabilityFile =
            serde_json::from_value(cap).expect("valid tauri capability");
        match parsed {
            tauri::utils::acl::capability::CapabilityFile::Capability(c) => {
                assert_eq!(c.identifier, "remote-server");
                assert!(!c.local);
                assert_eq!(c.remote.unwrap().urls.len(), 2);
                assert!(!c.permissions.is_empty());
            }
            _ => panic!("expected a single capability"),
        }
    }
}
