use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone)]
pub enum AppEvent {
    Input(ratatui::crossterm::event::KeyEvent),
    WebSocketConnecting,
    WebSocketConnected,
    WebSocketDisconnected,
    WebSocketMessage(String),
    WebSocketBinaryMessage(Vec<u8>),
    WebSocketError(String),
    SendWebSocketMessage(String),
    #[allow(dead_code)]
    ExtensionsLoaded(Vec<Extension>),
    SwitchToTab(usize),
    #[allow(dead_code)]
    Quit,
    LoadNextUntestedExtension,
    LoadPreviousUntestedExtension,
    LoadFirstUntestedExtension,
    LLMDescriptionReceived(String, String), // (extension_id, description)
    LLMDescriptionError(String, String),    // (extension_id, error)
    LLMFixStarted(String),                  // extension_id
    LLMFixSuccess(String, String),          // (extension_id, modified_files_json)
    LLMFixError(String, String),            // (extension_id, error)

    // Extension download events
    DownloadExtension(String),        // extension_id - request download
    ExtensionDownloadStarted(String), // extension_id
    ExtensionDownloaded(String, PathBuf, PathBuf), // (extension_id, mv2_path, mv3_path)
    ExtensionDownloadCached(String, PathBuf, PathBuf), // (extension_id, mv2_path, mv3_path) - from cache
    ExtensionDownloadCacheHit(String), // Server confirmed cache is valid - need to get paths from downloader
    ExtensionDownloadError(String, String), // (extension_id, error)
    ExtensionDownloadProgress {
        ext_id: String,
        chunks_received: usize,
        total_chunks: usize,
        bytes_received: usize,
        total_bytes: usize,
    },

    // Browser events
    LaunchBrowsers(PathBuf, PathBuf), // (mv2_path, mv3_path)
    BrowserLaunched,
    BrowserLaunchError(String),
    BrowserClosed,
    CloseBrowsersCmd,

    // Extension load status (diagnostic info after browser launch)
    ExtensionLoadStatus {
        browser_type: String,          // "MV2" or "MV3"
        loaded: bool,                  // Whether extension loaded successfully
        id: Option<String>,            // Extension ID if found
        name: Option<String>,          // Extension name if found
        error_message: Option<String>, // Error/warning message if not loaded
    },

    // Kitty terminal events
    OpenKittyTab(PathBuf, PathBuf), // (mv2_path, mv3_path)
    KittyTabOpened,
    KittyTabError(String),
}

/// State of the browser manager
#[derive(Debug, Clone, PartialEq, Default)]
pub enum BrowserState {
    #[default]
    Idle,
    Downloading,
    Launching,
    Running,
    Error(String),
}

#[derive(Debug, Clone, PartialEq)]
pub enum ConnectionState {
    Disconnected,
    Connecting,
    Connected,
}

#[derive(Debug, Clone)]
pub struct Message {
    pub msg_type: MessageType,
    pub content: String,
    #[allow(dead_code)]
    pub timestamp: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone)]
pub enum MessageType {
    #[allow(dead_code)]
    Sent,
    Received,
    System,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
pub struct CwsData {
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub images: CwsImages,
    #[serde(default)]
    pub details: CwsDetails,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
pub struct CwsDetails {
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub updated: Option<String>,
    #[serde(default)]
    pub size: Option<String>,
    #[serde(default)]
    pub languages: Vec<String>,
    #[serde(default)]
    pub user_count: Option<String>,
    #[serde(default)]
    pub rating: Option<String>,
    #[serde(default)]
    pub rating_count: Option<String>,
    #[serde(default)]
    pub website: Option<String>,
    #[serde(default)]
    pub developer: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
pub struct CwsImages {
    #[serde(default)]
    pub logo: Option<String>,
    #[serde(default)]
    pub screenshots: Vec<String>,
    #[serde(default)]
    pub video_thumbnails: Vec<String>,
    #[serde(default)]
    pub video_embeds: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct EventListener {
    pub api: String,
    pub file: String,
    #[serde(default)]
    pub line: Option<u32>,
    #[serde(default)]
    pub code_snippet: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Extension {
    #[serde(skip_serializing, default)]
    pub _id: Option<serde_json::Value>,
    #[serde(default)]
    pub id: Option<String>,
    pub name: String,
    #[serde(default)]
    pub manifest_v2_path: Option<String>,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub mv2_extension_id: Option<String>,
    #[serde(default)]
    pub mv3_extension_id: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default, rename = "interestingness_score")]
    pub interestingness: Option<f64>,
    #[serde(default)]
    pub migration_time_seconds: Option<f64>,
    #[serde(default)]
    pub input_path: Option<String>,
    #[serde(default)]
    pub manifest_v3_path: Option<String>,
    #[serde(default)]
    pub cws_info: Option<CwsData>,
    #[serde(default)]
    pub event_listeners: Vec<EventListener>,
    #[serde(skip_serializing, default)]
    #[allow(dead_code)]
    pub manifest: Option<serde_json::Value>,
    #[serde(skip_serializing, default)]
    #[allow(dead_code)]
    pub files: Option<serde_json::Value>,
    #[serde(skip_serializing, default, rename = "isNewTabExtension")]
    #[allow(dead_code)]
    pub is_new_tab_extension: Option<bool>,
    #[serde(skip_serializing, default)]
    #[allow(dead_code)]
    pub interestingness_breakdown: Option<serde_json::Value>,
    #[serde(skip_serializing, default)]
    #[allow(dead_code)]
    pub fakeium_validation: Option<serde_json::Value>,
    #[serde(skip)]
    pub llm_description: Option<String>,
    #[serde(skip)]
    pub showing_llm_description: bool,
}

impl Extension {
    pub fn get_id(&self) -> String {
        if let Some(ref id) = self.id {
            return id.clone();
        }
        if let Some(ref id_value) = self._id {
            if let Some(id_str) = id_value.as_str() {
                return id_str.to_string();
            }
            if let Some(oid) = id_value.get("$oid").and_then(|v| v.as_str()) {
                return oid.to_string();
            }
        }
        self.name.clone()
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
pub struct ExtensionStats {
    pub total: usize,
    pub with_mv3: usize,
    pub with_mv2_only: usize,
    pub failed: usize,
    pub avg_score: f64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ExtensionsWithStats {
    pub extensions: Vec<Extension>,
    pub stats: ExtensionStats,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ListenerTestResult {
    pub api: String,
    pub file: String,
    #[serde(default)]
    pub line: Option<u32>,
    pub status: String, // "untested", "yes", "no"
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Report {
    pub id: String,
    pub extension_id: String,
    pub tested: bool,
    pub created_at: f64,
    pub updated_at: f64,

    // Automatically collected
    #[serde(default)]
    pub verification_duration_secs: Option<f64>,

    // Quick assessment fields
    #[serde(default)]
    pub installs: Option<bool>,
    #[serde(default)]
    pub works_in_mv2: Option<bool>,
    #[serde(default)]
    pub overall_working: Option<String>, // Changed to String for tri-state: "yes", "no", "could_not_test"
    #[serde(default)]
    pub has_errors: Option<bool>,
    #[serde(default)]
    pub seems_slower: Option<bool>,
    #[serde(default)]
    pub needs_login: Option<bool>,
    #[serde(default)]
    pub is_popup_working: Option<bool>,
    #[serde(default)]
    pub is_settings_working: Option<bool>,
    #[serde(default)]
    pub is_new_tab_working: Option<bool>,
    #[serde(default)]
    pub is_interesting: Option<bool>,
    #[serde(default)]
    pub notes: Option<String>,

    // Per-listener testing
    #[serde(default)]
    pub listeners: Vec<ListenerTestResult>,
}
