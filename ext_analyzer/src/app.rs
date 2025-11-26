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
use tokio::sync::mpsc;

use crate::{
    tabs::{
        analyzer::AnalyzerTab, database::DatabaseTab, explorer::ExplorerTab, migrator::MigratorTab,
        Tab,
    },
    theme::ColorScheme,
    types::{
        AppEvent, ConnectionState, Extension, ExtensionStats, ExtensionsWithStats, Message,
        MessageType, Report,
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
    pub message_scroll_offset: usize,
    pub connection_state_changed_at: Option<std::time::Instant>,
    pub selected_extension_id: Option<String>,
    pub theme: ColorScheme,
    pub reports: Vec<Report>,
    pub llm_description_cache: HashMap<String, String>,
    pub llm_generating: HashSet<String>, // Track which extensions are currently generating
}

pub struct App {
    active_tab: usize,
    tabs: Vec<Box<dyn Tab>>,
    state: AppState,
    tx: mpsc::UnboundedSender<AppEvent>,
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
            message_scroll_offset: 0,
            connection_state_changed_at: Some(std::time::Instant::now()),
            selected_extension_id: None,
            theme: ColorScheme::default(),
            reports: Vec::new(),
            llm_description_cache: HashMap::new(),
            llm_generating: HashSet::new(),
        };

        let tabs: Vec<Box<dyn Tab>> = vec![
            Box::new(MigratorTab::new()),
            Box::new(ExplorerTab::new()),
            Box::new(AnalyzerTab::new()),
            Box::new(DatabaseTab::new()),
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

        // Split the menu bar area into tabs section and connection status section
        let menu_chunks = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([
                Constraint::Min(0),     // Tabs take remaining space
                Constraint::Length(16), // Connection status fixed width
            ])
            .split(area);

        let tab_names = vec!["Migrator", "Explorer", "Analyzer", "Database"];
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

        let tabs = Tabs::new(titles)
            .block(
                Block::default()
                    .borders(Borders::ALL)
                    .border_style(Style::new().fg(self.state.theme.menubar_border))
                    .title("ExtPorter"),
            )
            .select(self.active_tab)
            .style(Style::default())
            .highlight_style(
                Style::default()
                    .fg(self.state.theme.tab_active)
                    .add_modifier(Modifier::BOLD),
            );

        f.render_widget(tabs, menu_chunks[0]);

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
                .borders(Borders::ALL)
                .border_style(Style::new().fg(self.state.theme.menubar_border)),
        )
        .alignment(Alignment::Center);

        f.render_widget(connection_status, menu_chunks[1]);
    }

    pub fn handle_input(&mut self, key: KeyEvent) -> Result<()> {
        // Tab navigation with numbers 1-5
        let new_tab = match key.code {
            KeyCode::Char('1') => Some(0),
            KeyCode::Char('2') => Some(1),
            KeyCode::Char('3') => Some(2),
            KeyCode::Char('4') => Some(3),
            KeyCode::Left if self.active_tab > 0 => Some(self.active_tab - 1),
            KeyCode::Right if self.active_tab < self.tabs.len() - 1 => Some(self.active_tab + 1),
            _ => None,
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
                                    self.state.extensions = data.extensions;
                                    self.state.extension_stats = data.stats;

                                    // Add a message about loaded extensions
                                    if self.state.message_scroll_offset > 0 {
                                        self.state.message_scroll_offset += 1;
                                    }

                                    self.state.messages.push(Message {
                                        msg_type: MessageType::System,
                                        content: format!("✓ Loaded {} extensions (MV3: {}, Failed: {}, Avg Score: {:.2})", 
                                            count, 
                                            self.state.extension_stats.with_mv3,
                                            self.state.extension_stats.failed,
                                            self.state.extension_stats.avg_score
                                        ),
                                        timestamp: chrono::Utc::now(),
                                    });

                                    // Fetch reports
                                    let get_reports_msg = r#"{"type":"db_query","id":"get_reports","method":"getAllReports","params":{}}"#;
                                    let _ = self.tx.send(AppEvent::SendWebSocketMessage(
                                        get_reports_msg.to_string(),
                                    ));

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
                            return;
                        }
                    }
                    if id == "get_reports" {
                        if let Some(result) = json_msg.get("result") {
                            match serde_json::from_value::<Vec<Report>>(result.clone()) {
                                Ok(reports) => {
                                    self.state.reports = reports;

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

                            // Auto-load next untested extension
                            let _ = self.tx.send(AppEvent::LoadNextUntestedExtension);

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

        if msg.starts_with("MIGRATION_STATUS:") {
            if let Some(status) = msg.strip_prefix("MIGRATION_STATUS:") {
                let was_running = self.state.migration_running;
                self.state.migration_running = status.to_lowercase() == "running";

                // If migration just stopped, auto-refresh extensions list
                if was_running && !self.state.migration_running {
                    // Request updated extensions list from database
                    let extensions_request = r#"{"type":"db_query","id":"get_extensions","method":"getExtensionsWithStats","params":{}}"#;
                    let _ = self.tx.send(AppEvent::SendWebSocketMessage(
                        extensions_request.to_string(),
                    ));

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
                            let _ = self
                                .tx
                                .send(AppEvent::LLMDescriptionReceived(extension_id, description));
                        }
                    }
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

                // Still prefetch the next extension
                self.prefetch_next_extension_description(&ext_id);
            } else if !self.state.llm_generating.contains(&ext_id) {
                // Only request if not already generating
                self.state.llm_generating.insert(ext_id.clone());

                // Request LLM description for this extension
                let _ = self.tx.send(AppEvent::SendWebSocketMessage(format!(
                    "GENERATE_DESCRIPTION:{}",
                    ext_id
                )));

                // Prefetch description for the next+1 extension
                self.prefetch_next_extension_description(&ext_id);
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

                // Still prefetch the next extension
                self.prefetch_next_extension_description(&ext_id);
            } else if !self.state.llm_generating.contains(&ext_id) {
                // Only request if not already generating
                self.state.llm_generating.insert(ext_id.clone());

                // Request LLM description for this extension
                let _ = self.tx.send(AppEvent::SendWebSocketMessage(format!(
                    "GENERATE_DESCRIPTION:{}",
                    ext_id
                )));

                // Prefetch description for the next+1 extension
                self.prefetch_next_extension_description(&ext_id);
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

                // Still prefetch the next extension
                self.prefetch_next_extension_description(&ext_id);
            } else if !self.state.llm_generating.contains(&ext_id) {
                // Only request if not already generating
                self.state.llm_generating.insert(ext_id.clone());

                // Request LLM description for this extension
                let _ = self.tx.send(AppEvent::SendWebSocketMessage(format!(
                    "GENERATE_DESCRIPTION:{}",
                    ext_id
                )));

                // Prefetch description for the next+1 extension
                self.prefetch_next_extension_description(&ext_id);
            }
        }
    }

    /// Prefetch LLM description for the extension after the given ID
    fn prefetch_next_extension_description(&mut self, current_id: &str) {
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
            ext.llm_description = Some(description);
            // Only show LLM by default if this is the currently selected extension
            if self.state.selected_extension_id.as_ref() == Some(&ext_id) {
                ext.showing_llm_description = true;
            }
        }

        // After receiving any description, prefetch the next one
        // This creates a continuous chain of generation
        self.prefetch_next_extension_description(&ext_id);
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
}
