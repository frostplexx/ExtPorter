use anyhow::Result;
use ratatui::{
    crossterm::event::{KeyCode, KeyEvent},
    layout::{Constraint, Direction, Layout},
    style::{Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Tabs},
    Frame,
};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use tokio::sync::mpsc;

use crate::{
    tabs::{analyzer::AnalyzerTab, explorer::ExplorerTab, migrator::MigratorTab, ReportsTab, Tab},
    theme::ColorScheme,
    types::{
        AppEvent, BrowserState, ConnectionState, Extension, ExtensionStats, ExtensionsWithStats,
        Message, MessageType, Report,
    },
    websocket::WebSocketSender,
};

pub struct AppState {
    pub ws_connection_state: ConnectionState,
    pub ws_connected: bool,
    pub db_connected: bool,
    pub migration_running: bool,
    pub messages: Vec<Message>,
    pub extensions: Vec<Extension>,
    pub extension_stats: ExtensionStats,
    pub current_page: usize,
    pub page_size: usize,
    pub total_pages: usize,
    pub current_search: String,
    pub current_sort: crate::tabs::explorer::SortBy,
    pub current_random_seed: Option<String>,
    pub loading_extensions: bool,
    pub message_scroll_offset: usize,
    pub connection_state_changed_at: Option<std::time::Instant>,
    pub selected_extension_id: Option<String>,
    pub theme: ColorScheme,
    pub reports: Vec<Report>,
    pub llm_description_cache: HashMap<String, String>,
    pub llm_generating: HashSet<String>, // Track which extensions are currently generating
    pub llm_fixing: HashSet<String>,     // Track which extensions are currently being fixed
    pub browser_state: BrowserState,     // State of local browser manager
    pub current_extension_paths: Option<(PathBuf, PathBuf)>, // (mv2_path, mv3_path) for current extension
    pub pending_download_extension_id: Option<String>,       // Extension ID being downloaded
    // Download progress tracking (for chunked downloads)
    pub download_progress: Option<DownloadProgress>,
}

/// Progress of a chunked download
#[derive(Clone)]
pub struct DownloadProgress {
    pub ext_id: String,
    pub chunks_received: usize,
    pub total_chunks: usize,
    pub bytes_received: usize,
    pub total_bytes: usize,
}

pub struct App {
    active_tab: usize,
    tabs: Vec<Box<dyn Tab>>,
    state: AppState,
    pub tx: mpsc::UnboundedSender<AppEvent>,
}

impl App {
    pub fn new(tx: mpsc::UnboundedSender<AppEvent>, _ws_sender: WebSocketSender) -> Self {
        let state = AppState {
            ws_connection_state: ConnectionState::Connecting,
            ws_connected: false,
            db_connected: false,
            migration_running: false,
            messages: Vec::new(),
            extensions: Vec::new(),
            extension_stats: ExtensionStats::default(),
            current_page: 0,
            page_size: 100,
            total_pages: 1,
            current_search: String::new(),
            current_sort: crate::tabs::explorer::SortBy::InterestingnessDesc,
            current_random_seed: None,
            loading_extensions: false,
            message_scroll_offset: 0,
            connection_state_changed_at: Some(std::time::Instant::now()),
            selected_extension_id: None,
            theme: ColorScheme::default(),
            reports: Vec::new(),
            llm_description_cache: HashMap::new(),
            llm_generating: HashSet::new(),
            llm_fixing: HashSet::new(),
            browser_state: BrowserState::default(),
            current_extension_paths: None,
            pending_download_extension_id: None,
            download_progress: None,
        };

        let tabs: Vec<Box<dyn Tab>> = vec![
            Box::new(MigratorTab::new()),
            Box::new(ExplorerTab::new()),
            Box::new(AnalyzerTab::new()),
            Box::new(ReportsTab::new()),
        ];

        Self {
            active_tab: 0,
            tabs,
            state,
            tx,
        }
    }

    pub fn draw(&mut self, f: &mut Frame) {
        let chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints([Constraint::Length(3), Constraint::Min(0)])
            .split(f.area());

        // Render menu bar
        self.render_menu_bar(f, chunks[0]);

        // Render active tab
        if let Some(tab) = self.tabs.get_mut(self.active_tab) {
            tab.render(f, chunks[1], &self.state, self.tx.clone());
        }
    }

    fn render_menu_bar(&self, f: &mut Frame, area: ratatui::layout::Rect) {
        use ratatui::layout::{Alignment, Constraint, Direction, Layout};
        use ratatui::widgets::Paragraph;

        // Split the menu bar area into three sections: left padding, tabs, right status
        // Calculate tab width (approximately 15 chars per tab * 4 tabs)
        let tab_width = 60;
        let status_width = 16;
        let available_width = area.width.saturating_sub(status_width + 2); // -2 for borders
        let left_padding = (available_width.saturating_sub(tab_width)) / 2;

        let menu_chunks = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([
                Constraint::Length(left_padding), // Left padding for centering
                Constraint::Length(tab_width),    // Tabs centered
                Constraint::Min(0),               // Flexible space
                Constraint::Length(status_width), // Connection status fixed width
            ])
            .split(area);

        let tab_names = vec!["Migrator", "Explorer", "Analyzer", "Reports"];
        let titles: Vec<Line> = tab_names
            .iter()
            .enumerate()
            .map(|(i, name)| {
                let style = if i == self.active_tab {
                    Style::default()
                        .fg(self.state.theme.tab_active)
                        .add_modifier(Modifier::BOLD)
                } else {
                    Style::default().fg(self.state.theme.tab_inactive)
                };
                Line::from(vec![
                    Span::raw(format!("{}:", i + 1)),
                    Span::styled(format!(" {}", name), style),
                ])
            })
            .collect();

        // Render left padding block with title
        let left_block = Block::default()
            .borders(Borders::TOP | Borders::BOTTOM | Borders::LEFT)
            .border_style(Style::new().fg(self.state.theme.menubar_border))
            .title("ExtPorter");
        f.render_widget(left_block, menu_chunks[0]);

        // Render tabs in center
        let tabs = Tabs::new(titles)
            .block(
                Block::default()
                    .borders(Borders::TOP | Borders::BOTTOM)
                    .border_style(Style::new().fg(self.state.theme.menubar_border)),
            )
            .select(self.active_tab)
            .style(Style::default())
            .highlight_style(
                Style::default()
                    .fg(self.state.theme.tab_active)
                    .add_modifier(Modifier::BOLD),
            );

        f.render_widget(tabs, menu_chunks[1]);

        // Render right padding block
        let right_block = Block::default()
            .borders(Borders::TOP | Borders::BOTTOM)
            .border_style(Style::new().fg(self.state.theme.menubar_border));
        f.render_widget(right_block, menu_chunks[2]);

        // Create connection status indicator
        // Ensure connecting state shows for at least 500ms to avoid blinking
        let min_display_duration = std::time::Duration::from_millis(500);
        let should_show_connecting =
            if let Some(changed_at) = self.state.connection_state_changed_at {
                changed_at.elapsed() < min_display_duration
            } else {
                false
            };

        let (status_text, status_color) = match self.state.ws_connection_state {
            ConnectionState::Connected => ("●", self.state.theme.connection_active),
            ConnectionState::Connecting if should_show_connecting || !self.state.ws_connected => {
                ("◐", self.state.theme.connection_connecting)
            }
            ConnectionState::Connecting => ("●", self.state.theme.connection_active), // Fallback to connected if delay passed
            ConnectionState::Disconnected => ("●", self.state.theme.connection_disconnected),
        };

        let connection_status = Paragraph::new(Line::from(vec![
            Span::raw("Connection "),
            Span::styled(status_text, Style::default().fg(status_color)),
        ]))
        .block(
            Block::default()
                .borders(Borders::TOP | Borders::BOTTOM | Borders::RIGHT)
                .border_style(Style::new().fg(self.state.theme.menubar_border)),
        )
        .alignment(Alignment::Center);

        f.render_widget(connection_status, menu_chunks[3]);
    }

    pub fn handle_input(&mut self, key: KeyEvent) -> Result<()> {
        // Check if the current tab is in text input mode
        let is_text_input = if let Some(tab) = self.tabs.get(self.active_tab) {
            tab.is_in_text_input_mode()
        } else {
            false
        };

        // Only handle tab navigation if NOT in text input mode
        let new_tab = if !is_text_input {
            match key.code {
                KeyCode::Char('1') => Some(0),
                KeyCode::Char('2') => Some(1),
                KeyCode::Char('3') => Some(2),
                KeyCode::Char('4') => Some(3),
                KeyCode::Left if self.active_tab > 0 => Some(self.active_tab - 1),
                KeyCode::Right if self.active_tab < self.tabs.len() - 1 => {
                    Some(self.active_tab + 1)
                }
                _ => None,
            }
        } else {
            None
        };

        if let Some(tab_index) = new_tab {
            if tab_index != self.active_tab {
                self.active_tab = tab_index;
            }
        } else {
            // Pass input to active tab
            if let Some(tab) = self.tabs.get_mut(self.active_tab) {
                tab.handle_input(key, &mut self.state, self.tx.clone())?;
            }
        }

        Ok(())
    }

    pub fn switch_to_tab(&mut self, tab_index: usize) {
        if tab_index < self.tabs.len() {
            self.active_tab = tab_index;

            // If switching to Analyzer tab (index 2) with a selected extension, trigger LLM generation
            if tab_index == 2 {
                if let Some(ext_id) = self.state.selected_extension_id.clone() {
                    // Check if we have a cached description
                    if let Some(cached_desc) =
                        self.state.llm_description_cache.get(&ext_id).cloned()
                    {
                        // Apply cached description to the extension
                        if let Some(ext) = self
                            .state
                            .extensions
                            .iter_mut()
                            .find(|e| e.get_id() == ext_id)
                        {
                            ext.llm_description = Some(cached_desc);
                            ext.showing_llm_description = true;
                        }
                    } else if !self.state.llm_generating.contains(&ext_id) {
                        // Only request if not already generating
                        self.state.llm_generating.insert(ext_id.clone());

                        // Request LLM description for this extension
                        let _ = self.tx.send(AppEvent::SendWebSocketMessage(format!(
                            "GENERATE_DESCRIPTION:{}",
                            ext_id
                        )));
                    }
                }
            }
        }
    }

    pub fn handle_websocket_connecting(&mut self) {
        self.state.ws_connection_state = ConnectionState::Connecting;
        self.state.connection_state_changed_at = Some(std::time::Instant::now());

        // Don't add a message for every connection attempt, it would spam the log
    }

    pub fn handle_websocket_connected(&mut self) {
        self.state.ws_connection_state = ConnectionState::Connected;
        self.state.ws_connected = true;
        self.state.connection_state_changed_at = Some(std::time::Instant::now());

        // Add message
        if self.state.message_scroll_offset > 0 {
            self.state.message_scroll_offset += 1;
        }
        self.state.messages.push(Message {
            msg_type: MessageType::System,
            content: "Connected to Migration Server".to_string(),
            timestamp: chrono::Utc::now(),
        });
    }

    /// Set the loading state for extensions fetch
    pub fn set_loading_extensions(&mut self, v: bool) {
        self.state.loading_extensions = v;
    }

    pub fn handle_websocket_disconnected(&mut self) {
        self.state.ws_connection_state = ConnectionState::Disconnected;
        self.state.ws_connected = false;
        self.state.db_connected = false;
        self.state.connection_state_changed_at = Some(std::time::Instant::now());

        // If user is scrolled up, increment scroll offset to maintain view position
        if self.state.message_scroll_offset > 0 {
            self.state.message_scroll_offset += 1;
        }
    }

    pub fn handle_websocket_message(&mut self, msg: String) {
        // Try to parse as JSON first for database responses
        if let Ok(json_msg) = serde_json::from_str::<serde_json::Value>(&msg) {
            // Handle database responses
            if json_msg.get("type").and_then(|v| v.as_str()) == Some("db_response") {
                if let Some(id) = json_msg.get("id").and_then(|v| v.as_str()) {
                    if id == "get_extensions" {
                        if let Some(result) = json_msg.get("result") {
                            // Try to parse as ExtensionsWithStats first
                            match serde_json::from_value::<ExtensionsWithStats>(result.clone()) {
                                Ok(data) => {
                                    let count = data.extensions.len();

                                    // Determine page info (defaults)
                                    let page = data.page.unwrap_or(0);
                                    let page_size = data.page_size.unwrap_or(100);
                                    let total_pages = data.total_pages.unwrap_or(1);

                                    if page == 0 {
                                        // First page => replace
                                        self.state.extensions = data.extensions;
                                    } else {
                                        // Append subsequent pages
                                        self.state.extensions.extend(data.extensions);
                                    }

                                    self.state.extension_stats = data.stats;
                                    self.state.current_page = page;
                                    self.state.page_size = page_size;
                                    self.state.total_pages = total_pages;

                                    // Add a message about loaded extensions/page
                                    if self.state.message_scroll_offset > 0 {
                                        self.state.message_scroll_offset += 1;
                                    }

                                    self.state.messages.push(Message {
                                        msg_type: MessageType::System,
                                        content: format!("✓ Loaded {} extensions (page {}/{}, MV3: {}, Failed: {}, Avg Score: {:.2})", 
                                            count, 
                                            page + 1,
                                            total_pages,
                                            self.state.extension_stats.with_mv3,
                                            self.state.extension_stats.failed,
                                            self.state.extension_stats.avg_score
                                        ),
                                        timestamp: chrono::Utc::now(),
                                    });

                                    // Clear loading flag after receiving a page
                                    self.state.loading_extensions = false;

                                    // Fetch reports only after first page
                                    if page == 0 {
                                        let get_reports_msg = r#"{"type":"db_query","id":"get_reports","method":"getAllReports","params":{}}"#;
                                        let _ = self.tx.send(AppEvent::SendWebSocketMessage(
                                            get_reports_msg.to_string(),
                                        ));
                                    }

                                    return;
                                }
                                Err(e) => {
                                    // Log detailed parse error with JSON snippet
                                    if self.state.message_scroll_offset > 0 {
                                        self.state.message_scroll_offset += 1;
                                    }

                                    let json_preview = serde_json::to_string_pretty(result)
                                        .unwrap_or_else(|_| "<invalid json>".to_string());
                                    let preview = if json_preview.len() > 200 {
                                        format!("{}...", &json_preview[..200])
                                    } else {
                                        json_preview
                                    };

                                    self.state.messages.push(Message {
                                        msg_type: MessageType::System,
                                        content: format!(
                                            "Error parsing extensions: {} | Data preview: {}",
                                            e, preview
                                        ),
                                        timestamp: chrono::Utc::now(),
                                    });
                                    // Clear loading flag on parse error
                                    self.state.loading_extensions = false;
                                    return;
                                }
                            }
                        }
                        // Check for error
                        if let Some(error) = json_msg.get("error").and_then(|v| v.as_str()) {
                            if self.state.message_scroll_offset > 0 {
                                self.state.message_scroll_offset += 1;
                            }

                            self.state.messages.push(Message {
                                msg_type: MessageType::System,
                                content: format!("Error loading extensions: {}", error),
                                timestamp: chrono::Utc::now(),
                            });
                            // Clear loading flag on server error response
                            self.state.loading_extensions = false;
                            return;
                        }
                    }
                    if id == "get_reports" {
                        if let Some(result) = json_msg.get("result") {
                            match serde_json::from_value::<Vec<Report>>(result.clone()) {
                                Ok(server_reports) => {
                                    // Merge server reports with local reports
                                    // Keep local reports (with "local_" prefix) that aren't yet on server
                                    // This prevents race conditions where server sync overwrites
                                    // optimistic local updates before they're persisted
                                    let local_only: Vec<Report> = self
                                        .state
                                        .reports
                                        .iter()
                                        .filter(|r| {
                                            r.id.starts_with("local_")
                                                && !server_reports
                                                    .iter()
                                                    .any(|sr| sr.extension_id == r.extension_id)
                                        })
                                        .cloned()
                                        .collect();

                                    // Start with server reports, then add local-only ones
                                    self.state.reports = server_reports;
                                    self.state.reports.extend(local_only);

                                    if self.state.message_scroll_offset > 0 {
                                        self.state.message_scroll_offset += 1;
                                    }

                                    self.state.messages.push(Message {
                                        msg_type: MessageType::System,
                                        content: format!(
                                            "✓ Loaded {} testing reports",
                                            self.state.reports.len()
                                        ),
                                        timestamp: chrono::Utc::now(),
                                    });

                                    // Auto-load first untested extension if none selected
                                    if self.state.selected_extension_id.is_none() {
                                        let _ = self.tx.send(AppEvent::LoadFirstUntestedExtension);
                                    }

                                    return;
                                }
                                Err(e) => {
                                    if self.state.message_scroll_offset > 0 {
                                        self.state.message_scroll_offset += 1;
                                    }

                                    self.state.messages.push(Message {
                                        msg_type: MessageType::System,
                                        content: format!("Error parsing reports: {}", e),
                                        timestamp: chrono::Utc::now(),
                                    });
                                    return;
                                }
                            }
                        }
                    }
                    if id == "create_report" {
                        if json_msg.get("error").is_none() {
                            if self.state.message_scroll_offset > 0 {
                                self.state.message_scroll_offset += 1;
                            }

                            self.state.messages.push(Message {
                                msg_type: MessageType::System,
                                content: "✓ Extension marked as tested".to_string(),
                                timestamp: chrono::Utc::now(),
                            });

                            // NOTE: We do NOT trigger LoadNextUntestedExtension here because
                            // it's already triggered in submit_report() immediately after submission.
                            // Triggering it again here would cause a double navigation (skip bug).

                            return;
                        }
                    }
                }
            }
        }

        // Parse special messages
        if msg.starts_with("DB_STATUS:") {
            if let Some(status) = msg.strip_prefix("DB_STATUS:") {
                self.state.db_connected = status.to_lowercase() == "connected";
            }
            return;
        }

        // Handle browser launch success
        if msg == "DUAL_BROWSERS_LAUNCHED" {
            if self.state.message_scroll_offset > 0 {
                self.state.message_scroll_offset += 1;
            }
            self.state.messages.push(Message {
                msg_type: MessageType::System,
                content: "✓ Browsers launched successfully".to_string(),
                timestamp: chrono::Utc::now(),
            });
            return;
        }

        // Handle browser close success
        if msg == "BROWSERS_CLOSED" {
            if self.state.message_scroll_offset > 0 {
                self.state.message_scroll_offset += 1;
            }
            self.state.messages.push(Message {
                msg_type: MessageType::System,
                content: "✓ Browsers closed".to_string(),
                timestamp: chrono::Utc::now(),
            });
            return;
        }

        // Handle ERROR messages from server (e.g., browser launch failures)
        if msg.starts_with("ERROR:") || msg.starts_with("ERROR ") {
            let error_msg = msg
                .strip_prefix("ERROR:")
                .or_else(|| msg.strip_prefix("ERROR "))
                .unwrap_or(&msg)
                .trim();

            if self.state.message_scroll_offset > 0 {
                self.state.message_scroll_offset += 1;
            }
            self.state.messages.push(Message {
                msg_type: MessageType::System,
                content: format!("✗ Error: {}", error_msg),
                timestamp: chrono::Utc::now(),
            });
            return;
        }

        if msg.starts_with("MIGRATION_STATUS:") {
            if let Some(status) = msg.strip_prefix("MIGRATION_STATUS:") {
                let was_running = self.state.migration_running;
                self.state.migration_running = status.to_lowercase() == "running";

                // If migration just stopped, auto-refresh extensions list
                if was_running && !self.state.migration_running {
                    // Request updated extensions list from database
                    let mut params = serde_json::json!({ "page": 0, "pageSize": 100, "search": self.state.current_search, "sort": self.state.current_sort.to_param() });
                    if let Some(ref s) = self.state.current_random_seed {
                        params["seed"] = serde_json::json!(s);
                    }
                    let query = serde_json::json!({
                        "type": "db_query",
                        "id": "get_extensions",
                        "method": "getExtensionsWithStats",
                        "params": params
                    });
                    // Show loading indicator
                    self.set_loading_extensions(true);
                    let _ = self
                        .tx
                        .send(AppEvent::SendWebSocketMessage(query.to_string()));

                    // Add notification message
                    if self.state.message_scroll_offset > 0 {
                        self.state.message_scroll_offset += 1;
                    }
                    self.state.messages.push(Message {
                        msg_type: MessageType::System,
                        content: "🔄 Migration completed, refreshing extension list...".to_string(),
                        timestamp: chrono::Utc::now(),
                    });
                }
            }
            return;
        }

        // Parse LLM description messages
        if msg.starts_with("LLM_DESCRIPTION:") {
            if let Some(rest) = msg.strip_prefix("LLM_DESCRIPTION:") {
                let parts: Vec<&str> = rest.splitn(2, ':').collect();
                if parts.len() == 2 {
                    let extension_id = parts[0].to_string();
                    // Decode base64 description
                    use base64::Engine;
                    if let Ok(decoded) = base64::engine::general_purpose::STANDARD.decode(parts[1])
                    {
                        if let Ok(description) = String::from_utf8(decoded) {
                            let _ = self.tx.send(AppEvent::LLMDescriptionReceived(
                                extension_id.clone(),
                                description.clone(),
                            ));
                        } else {
                        }
                    } else {
                    }
                } else {
                }
            }
            return;
        }

        if msg.starts_with("LLM_DESCRIPTION_ERROR:") {
            if let Some(rest) = msg.strip_prefix("LLM_DESCRIPTION_ERROR:") {
                let parts: Vec<&str> = rest.splitn(2, ':').collect();
                if parts.len() == 2 {
                    let extension_id = parts[0].to_string();
                    let error = parts[1].to_string();
                    let _ = self
                        .tx
                        .send(AppEvent::LLMDescriptionError(extension_id, error));
                }
            }
            return;
        }

        // Parse LLM fix messages
        if msg.starts_with("FIX_EXTENSION_SUCCESS:") {
            if let Some(rest) = msg.strip_prefix("FIX_EXTENSION_SUCCESS:") {
                let parts: Vec<&str> = rest.splitn(2, ':').collect();
                if parts.len() == 2 {
                    let extension_id = parts[0].to_string();
                    let modified_files_json = parts[1].to_string();
                    let _ = self
                        .tx
                        .send(AppEvent::LLMFixSuccess(extension_id, modified_files_json));
                }
            }
            return;
        }

        if msg.starts_with("FIX_EXTENSION_ERROR:") {
            if let Some(rest) = msg.strip_prefix("FIX_EXTENSION_ERROR:") {
                let parts: Vec<&str> = rest.splitn(2, ':').collect();
                if parts.len() == 2 {
                    let extension_id = parts[0].to_string();
                    let error = parts[1].to_string();
                    let _ = self.tx.send(AppEvent::LLMFixError(extension_id, error));
                }
            }
            return;
        }

        // Parse extension download text messages (cached/error responses are text, data is binary)
        if msg.starts_with("DOWNLOAD_EXTENSION_CACHED:") {
            if let Some(ext_id) = msg.strip_prefix("DOWNLOAD_EXTENSION_CACHED:") {
                // Server says hash matched - need to use local cache
                let _ = self.tx.send(AppEvent::ExtensionDownloadCacheHit(
                    ext_id.trim().to_string(),
                ));
            }
            return;
        }

        if msg.starts_with("DOWNLOAD_EXTENSION_ERROR:") {
            if let Some(rest) = msg.strip_prefix("DOWNLOAD_EXTENSION_ERROR:") {
                let parts: Vec<&str> = rest.splitn(2, ':').collect();
                if parts.len() >= 1 {
                    let ext_id = parts[0].trim().to_string();
                    let error = if parts.len() >= 2 {
                        parts[1].to_string()
                    } else {
                        "Unknown error".to_string()
                    };
                    let _ = self
                        .tx
                        .send(AppEvent::ExtensionDownloadError(ext_id, error));
                }
            }
            return;
        }

        // Parse message type
        let (msg_type, content) = if msg.starts_with("STDOUT: ") {
            (
                MessageType::System,
                msg.strip_prefix("STDOUT: ").unwrap().to_string(),
            )
        } else if msg.starts_with("STDERR: ") {
            (
                MessageType::System,
                format!("⚠ {}", msg.strip_prefix("STDERR: ").unwrap()),
            )
        } else {
            (MessageType::Received, msg)
        };

        // Normalize content (single line)
        let content = content
            .replace('\n', " ")
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ");

        // Add message first
        self.state.messages.push(Message {
            msg_type,
            content,
            timestamp: chrono::Utc::now(),
        });

        // Handle scroll position AFTER adding the message:
        // - If at bottom (offset = 0), stay there
        // - If scrolled up (offset > 0), increment offset to maintain view position
        if self.state.message_scroll_offset > 0 {
            self.state.message_scroll_offset += 1;

            // Safety check: don't let offset exceed total messages
            let max_offset = self.state.messages.len().saturating_sub(1);
            if self.state.message_scroll_offset > max_offset {
                self.state.message_scroll_offset = max_offset;
            }
        }
    }

    pub fn handle_websocket_error(&mut self, err: String) {
        // If user is scrolled up, increment scroll offset to maintain view position
        if self.state.message_scroll_offset > 0 {
            self.state.message_scroll_offset += 1;
        }

        // filter out no connection errors when e.g. Connection refused
        // because thats already being shown in the tab bar
        if !err.eq("IO error: Connection refused (os error 61)") {
            self.state.messages.push(Message {
                msg_type: MessageType::System,
                content: format!("Server Error: {}", err),
                timestamp: chrono::Utc::now(),
            });
        }
    }

    /// Find the next untested extension after the current one
    /// Returns the extension ID if found
    pub fn find_next_untested_extension(&self) -> Option<String> {
        let current_id = self.state.selected_extension_id.as_ref()?;

        // Find current extension's index
        let current_idx = self
            .state
            .extensions
            .iter()
            .position(|e| &e.get_id() == current_id)?;

        // Search forward from current position
        for ext in self.state.extensions.iter().skip(current_idx + 1) {
            let is_tested = self
                .state
                .reports
                .iter()
                .any(|r| r.extension_id == ext.get_id() && r.tested);
            if !is_tested && ext.mv3_extension_id.is_some() {
                return Some(ext.get_id());
            }
        }

        None
    }

    /// Find the previous untested extension before the current one
    /// Returns the extension ID if found
    pub fn find_previous_untested_extension(&self) -> Option<String> {
        let current_id = self.state.selected_extension_id.as_ref()?;

        // Find current extension's index
        let current_idx = self
            .state
            .extensions
            .iter()
            .position(|e| &e.get_id() == current_id)?;

        // Search backward from current position
        for ext in self.state.extensions.iter().take(current_idx).rev() {
            let is_tested = self
                .state
                .reports
                .iter()
                .any(|r| r.extension_id == ext.get_id() && r.tested);
            if !is_tested && ext.mv3_extension_id.is_some() {
                return Some(ext.get_id());
            }
        }

        None
    }

    /// Find the first untested extension in the list
    /// Returns the extension ID if found
    pub fn find_first_untested_extension(&self) -> Option<String> {
        self.state
            .extensions
            .iter()
            .find(|ext| {
                let is_tested = self
                    .state
                    .reports
                    .iter()
                    .any(|r| r.extension_id == ext.get_id() && r.tested);
                !is_tested && ext.mv3_extension_id.is_some()
            })
            .map(|ext| ext.get_id())
    }

    /// Handle loading the next untested extension
    pub fn handle_load_next_untested_extension(&mut self) {
        if let Some(ext_id) = self.find_next_untested_extension() {
            self.state.selected_extension_id = Some(ext_id.clone());

            if self.state.message_scroll_offset > 0 {
                self.state.message_scroll_offset += 1;
            }
            self.state.messages.push(Message {
                msg_type: MessageType::System,
                content: "→ Loaded next untested extension".to_string(),
                timestamp: chrono::Utc::now(),
            });

            // Only generate descriptions if we're on the Analyzer tab (index 2)
            if self.active_tab == 2 {
                // Check if we have a cached description
                if let Some(cached_desc) = self.state.llm_description_cache.get(&ext_id).cloned() {
                    // Apply cached description to the extension
                    if let Some(ext) = self
                        .state
                        .extensions
                        .iter_mut()
                        .find(|e| e.get_id() == ext_id)
                    {
                        ext.llm_description = Some(cached_desc);
                        ext.showing_llm_description = true;
                    }
                } else if !self.state.llm_generating.contains(&ext_id) {
                    // Only request if not already generating
                    self.state.llm_generating.insert(ext_id.clone());

                    // Request LLM description for this extension
                    let _ = self.tx.send(AppEvent::SendWebSocketMessage(format!(
                        "GENERATE_DESCRIPTION:{}",
                        ext_id
                    )));
                }
            }
        } else {
            if self.state.message_scroll_offset > 0 {
                self.state.message_scroll_offset += 1;
            }
            self.state.messages.push(Message {
                msg_type: MessageType::System,
                content: "No more untested extensions".to_string(),
                timestamp: chrono::Utc::now(),
            });
        }
    }

    /// Handle loading the previous untested extension
    pub fn handle_load_previous_untested_extension(&mut self) {
        if let Some(ext_id) = self.find_previous_untested_extension() {
            self.state.selected_extension_id = Some(ext_id.clone());

            if self.state.message_scroll_offset > 0 {
                self.state.message_scroll_offset += 1;
            }
            self.state.messages.push(Message {
                msg_type: MessageType::System,
                content: "← Loaded previous untested extension".to_string(),
                timestamp: chrono::Utc::now(),
            });

            // Only generate descriptions if we're on the Analyzer tab (index 2)
            if self.active_tab == 2 {
                // Check if we have a cached description
                if let Some(cached_desc) = self.state.llm_description_cache.get(&ext_id).cloned() {
                    // Apply cached description to the extension
                    if let Some(ext) = self
                        .state
                        .extensions
                        .iter_mut()
                        .find(|e| e.get_id() == ext_id)
                    {
                        ext.llm_description = Some(cached_desc);
                        ext.showing_llm_description = true;
                    }
                } else if !self.state.llm_generating.contains(&ext_id) {
                    // Only request if not already generating
                    self.state.llm_generating.insert(ext_id.clone());

                    // Request LLM description for this extension
                    let _ = self.tx.send(AppEvent::SendWebSocketMessage(format!(
                        "GENERATE_DESCRIPTION:{}",
                        ext_id
                    )));
                }
            }
        } else {
            if self.state.message_scroll_offset > 0 {
                self.state.message_scroll_offset += 1;
            }
            self.state.messages.push(Message {
                msg_type: MessageType::System,
                content: "No previous untested extensions".to_string(),
                timestamp: chrono::Utc::now(),
            });
        }
    }

    /// Handle loading the first untested extension
    pub fn handle_load_first_untested_extension(&mut self) {
        if let Some(ext_id) = self.find_first_untested_extension() {
            self.state.selected_extension_id = Some(ext_id.clone());

            if self.state.message_scroll_offset > 0 {
                self.state.message_scroll_offset += 1;
            }
            self.state.messages.push(Message {
                msg_type: MessageType::System,
                content: "→ Loaded first untested extension".to_string(),
                timestamp: chrono::Utc::now(),
            });

            // Only generate descriptions if we're on the Analyzer tab (index 2)
            if self.active_tab == 2 {
                // Check if we have a cached description
                if let Some(cached_desc) = self.state.llm_description_cache.get(&ext_id).cloned() {
                    // Apply cached description to the extension
                    if let Some(ext) = self
                        .state
                        .extensions
                        .iter_mut()
                        .find(|e| e.get_id() == ext_id)
                    {
                        ext.llm_description = Some(cached_desc);
                        ext.showing_llm_description = true;
                    }
                } else if !self.state.llm_generating.contains(&ext_id) {
                    // Only request if not already generating
                    self.state.llm_generating.insert(ext_id.clone());

                    // Request LLM description for this extension
                    let _ = self.tx.send(AppEvent::SendWebSocketMessage(format!(
                        "GENERATE_DESCRIPTION:{}",
                        ext_id
                    )));
                }
            }
        }
    }

    /// Prefetch LLM description for the extension after the given ID
    fn prefetch_next_extension_description(&mut self, current_id: &str) {
        // Only prefetch if we're on the Analyzer tab (index 2)
        if self.active_tab != 2 {
            return;
        }

        // Find current extension's index
        if let Some(current_idx) = self
            .state
            .extensions
            .iter()
            .position(|e| e.get_id() == current_id)
        {
            // Find the next untested extension after current
            for ext in self.state.extensions.iter().skip(current_idx + 1) {
                let is_tested = self
                    .state
                    .reports
                    .iter()
                    .any(|r| r.extension_id == ext.get_id() && r.tested);
                if !is_tested && ext.mv3_extension_id.is_some() {
                    let ext_id = ext.get_id();

                    // Check if we already have this description (in cache OR in extension object OR currently generating)
                    let has_description = self.state.llm_description_cache.contains_key(&ext_id)
                        || ext.llm_description.is_some()
                        || self.state.llm_generating.contains(&ext_id);

                    if !has_description {
                        // Mark as generating and prefetch it
                        self.state.llm_generating.insert(ext_id.clone());
                        let _ = self.tx.send(AppEvent::SendWebSocketMessage(format!(
                            "GENERATE_DESCRIPTION:{}",
                            ext_id
                        )));
                    }
                    break;
                }
            }
        }
    }

    /// Handle receiving an LLM description
    pub fn handle_llm_description_received(&mut self, ext_id: String, description: String) {
        // Remove from generating set
        self.state.llm_generating.remove(&ext_id);

        // Store in cache
        self.state
            .llm_description_cache
            .insert(ext_id.clone(), description.clone());

        // Always update the extension object, regardless of whether it's currently selected
        // This ensures prefetched descriptions are available when we navigate to them
        if let Some(ext) = self
            .state
            .extensions
            .iter_mut()
            .find(|e| e.get_id() == ext_id)
        {
            ext.llm_description = Some(description.clone());
            // Only show LLM by default if this is the currently selected extension
            if self.state.selected_extension_id.as_ref() == Some(&ext_id) {
                ext.showing_llm_description = true;
            }
        }

        // Only prefetch the next one if this was the CURRENT extension being viewed
        // This prevents infinite prefetching
        if self.state.selected_extension_id.as_ref() == Some(&ext_id) {
            self.prefetch_next_extension_description(&ext_id);
        }
    }

    /// Handle LLM description generation error
    pub fn handle_llm_description_error(&mut self, ext_id: String, error: String) {
        // Remove from generating set on error
        self.state.llm_generating.remove(&ext_id);

        // Only show error message if this is the currently selected extension
        if let Some(selected_id) = &self.state.selected_extension_id {
            if selected_id == &ext_id {
                if self.state.message_scroll_offset > 0 {
                    self.state.message_scroll_offset += 1;
                }
                self.state.messages.push(Message {
                    msg_type: MessageType::System,
                    content: format!("⚠ LLM description generation failed: {}", error),
                    timestamp: chrono::Utc::now(),
                });
            }
        }
    }

    /// Handle LLM fix started
    pub fn handle_llm_fix_started(&mut self, ext_id: String) {
        // Add to fixing set
        self.state.llm_fixing.insert(ext_id.clone());

        if self.state.message_scroll_offset > 0 {
            self.state.message_scroll_offset += 1;
        }
        self.state.messages.push(Message {
            msg_type: MessageType::System,
            content: format!("🔧 Starting LLM fix for extension..."),
            timestamp: chrono::Utc::now(),
        });
    }

    /// Handle LLM fix success
    pub fn handle_llm_fix_success(&mut self, ext_id: String, modified_files_json: String) {
        // Remove from fixing set
        self.state.llm_fixing.remove(&ext_id);

        // Parse modified files list
        let files_msg = if let Ok(files) = serde_json::from_str::<Vec<String>>(&modified_files_json)
        {
            if files.is_empty() {
                "No files were modified".to_string()
            } else {
                format!("Modified {} file(s): {}", files.len(), files.join(", "))
            }
        } else {
            modified_files_json
        };

        if self.state.message_scroll_offset > 0 {
            self.state.message_scroll_offset += 1;
        }
        self.state.messages.push(Message {
            msg_type: MessageType::System,
            content: format!("✓ LLM fix completed successfully. {}", files_msg),
            timestamp: chrono::Utc::now(),
        });
    }

    /// Handle LLM fix error
    pub fn handle_llm_fix_error(&mut self, ext_id: String, error: String) {
        // Remove from fixing set
        self.state.llm_fixing.remove(&ext_id);

        if self.state.message_scroll_offset > 0 {
            self.state.message_scroll_offset += 1;
        }
        self.state.messages.push(Message {
            msg_type: MessageType::System,
            content: format!("✗ LLM fix failed: {}", error),
            timestamp: chrono::Utc::now(),
        });
    }

    // =========================================================================
    // Browser and Extension Download Handlers
    // =========================================================================

    /// Handle extension download started
    pub fn handle_extension_download_started(&mut self, ext_id: String) {
        self.state.browser_state = BrowserState::Downloading;
        self.state.pending_download_extension_id = Some(ext_id.clone());

        if self.state.message_scroll_offset > 0 {
            self.state.message_scroll_offset += 1;
        }
        self.state.messages.push(Message {
            msg_type: MessageType::System,
            content: format!("Downloading extension {}...", ext_id),
            timestamp: chrono::Utc::now(),
        });
    }

    /// Handle extension downloaded successfully
    pub fn handle_extension_downloaded(
        &mut self,
        ext_id: String,
        mv2_path: PathBuf,
        mv3_path: PathBuf,
    ) {
        self.state.current_extension_paths = Some((mv2_path.clone(), mv3_path.clone()));
        self.state.pending_download_extension_id = None;
        self.state.download_progress = None;
        self.state.browser_state = BrowserState::Launching;

        if self.state.message_scroll_offset > 0 {
            self.state.message_scroll_offset += 1;
        }
        self.state.messages.push(Message {
            msg_type: MessageType::System,
            content: format!("✓ Extension {} downloaded, launching browsers...", ext_id),
            timestamp: chrono::Utc::now(),
        });

        // Automatically launch browsers after download
        let _ = self.tx.send(AppEvent::LaunchBrowsers(mv2_path, mv3_path));
    }

    /// Handle extension download from cache
    pub fn handle_extension_download_cached(
        &mut self,
        ext_id: String,
        mv2_path: PathBuf,
        mv3_path: PathBuf,
    ) {
        self.state.current_extension_paths = Some((mv2_path.clone(), mv3_path.clone()));
        self.state.pending_download_extension_id = None;
        self.state.download_progress = None;
        self.state.browser_state = BrowserState::Launching;

        if self.state.message_scroll_offset > 0 {
            self.state.message_scroll_offset += 1;
        }
        self.state.messages.push(Message {
            msg_type: MessageType::System,
            content: format!("✓ Extension {} (cached), launching browsers...", ext_id),
            timestamp: chrono::Utc::now(),
        });

        // Automatically launch browsers after cache hit
        let _ = self.tx.send(AppEvent::LaunchBrowsers(mv2_path, mv3_path));
    }

    /// Handle extension download error
    pub fn handle_extension_download_error(&mut self, ext_id: String, error: String) {
        self.state.browser_state = BrowserState::Error(error.clone());
        self.state.pending_download_extension_id = None;
        self.state.download_progress = None;

        if self.state.message_scroll_offset > 0 {
            self.state.message_scroll_offset += 1;
        }
        self.state.messages.push(Message {
            msg_type: MessageType::System,
            content: format!("✗ Failed to download extension {}: {}", ext_id, error),
            timestamp: chrono::Utc::now(),
        });
    }

    /// Handle extension download progress (for chunked downloads)
    pub fn handle_extension_download_progress(
        &mut self,
        ext_id: String,
        chunks_received: usize,
        total_chunks: usize,
        bytes_received: usize,
        total_bytes: usize,
    ) {
        self.state.download_progress = Some(DownloadProgress {
            ext_id,
            chunks_received,
            total_chunks,
            bytes_received,
            total_bytes,
        });
    }

    /// Handle browsers launched successfully
    pub fn handle_browser_launched(&mut self) {
        self.state.browser_state = BrowserState::Running;

        if self.state.message_scroll_offset > 0 {
            self.state.message_scroll_offset += 1;
        }
        self.state.messages.push(Message {
            msg_type: MessageType::System,
            content: "✓ Browsers launched successfully".to_string(),
            timestamp: chrono::Utc::now(),
        });

        // Notify the AnalyzerTab (index 2) that browsers have launched
        // so it can show the form if one was pending
        if let Some(tab) = self.tabs.get_mut(2) {
            if let Some(analyzer_tab) = tab.as_any_mut().downcast_mut::<AnalyzerTab>() {
                analyzer_tab.on_browser_launched();
            }
        }
    }

    /// Handle browser launch error
    pub fn handle_browser_launch_error(&mut self, error: String) {
        self.state.browser_state = BrowserState::Error(error.clone());

        if self.state.message_scroll_offset > 0 {
            self.state.message_scroll_offset += 1;
        }
        self.state.messages.push(Message {
            msg_type: MessageType::System,
            content: format!("✗ Failed to launch browsers: {}", error),
            timestamp: chrono::Utc::now(),
        });
    }

    /// Handle browsers closed
    pub fn handle_browser_closed(&mut self) {
        self.state.browser_state = BrowserState::Idle;
        // Keep current_extension_paths for potential kitty tab opening

        if self.state.message_scroll_offset > 0 {
            self.state.message_scroll_offset += 1;
        }
        self.state.messages.push(Message {
            msg_type: MessageType::System,
            content: "✓ Browsers closed".to_string(),
            timestamp: chrono::Utc::now(),
        });
    }

    /// Handle extension load status event (diagnostic info after browser launch)
    pub fn handle_extension_load_status(
        &mut self,
        browser_type: String,
        loaded: bool,
        id: Option<String>,
        name: Option<String>,
        error_message: Option<String>,
    ) {
        if self.state.message_scroll_offset > 0 {
            self.state.message_scroll_offset += 1;
        }

        let msg = if loaded {
            format!(
                "  {} extension loaded: {} ({})",
                browser_type,
                name.unwrap_or_else(|| "Unknown".to_string()),
                id.unwrap_or_else(|| "no-id".to_string())
            )
        } else {
            format!(
                "  ⚠ {} extension issue: {}",
                browser_type,
                error_message.unwrap_or_else(|| "Unknown error".to_string())
            )
        };

        self.state.messages.push(Message {
            msg_type: MessageType::System,
            content: msg,
            timestamp: chrono::Utc::now(),
        });
    }

    /// Handle kitty tab opened
    pub fn handle_kitty_tab_opened(&mut self) {
        if self.state.message_scroll_offset > 0 {
            self.state.message_scroll_offset += 1;
        }
        self.state.messages.push(Message {
            msg_type: MessageType::System,
            content: "✓ Opened extension folders in kitty".to_string(),
            timestamp: chrono::Utc::now(),
        });
    }

    /// Handle kitty tab error
    pub fn handle_kitty_tab_error(&mut self, error: String) {
        if self.state.message_scroll_offset > 0 {
            self.state.message_scroll_offset += 1;
        }
        self.state.messages.push(Message {
            msg_type: MessageType::System,
            content: format!("✗ Failed to open kitty tab: {}", error),
            timestamp: chrono::Utc::now(),
        });
    }

    /// Get current extension paths (for kitty tab opening)
    pub fn get_current_extension_paths(&self) -> Option<(PathBuf, PathBuf)> {
        self.state.current_extension_paths.clone()
    }
}
