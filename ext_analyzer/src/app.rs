use anyhow::Result;
use crossterm::event::{KeyCode, KeyEvent};
use ratatui::{
    layout::{Constraint, Direction, Layout},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Tabs},
    Frame,
};
use tokio::sync::mpsc;

use crate::{
    tabs::{
        analyzer::AnalyzerTab, database::DatabaseTab, explorer::ExplorerTab, migrator::MigratorTab,
        settings::SettingsTab, Tab,
    },
    websocket::WebSocketSender,
};

#[derive(Debug, Clone)]
pub enum AppEvent {
    Input(KeyEvent),
    WebSocketConnecting,
    WebSocketConnected,
    WebSocketDisconnected,
    WebSocketMessage(String),
    WebSocketError(String),
    SendWebSocketMessage(String),
    ExtensionsLoaded(Vec<Extension>),
    SwitchToTab(usize),
    Quit,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ConnectionState {
    Disconnected,
    Connecting,
    Connected,
}

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
    pub last_message_time: Option<std::time::Instant>,
    pub recent_message_count: usize,
    pub burst_window_start: Option<std::time::Instant>,
    pub selected_extension_id: Option<String>,
}

#[derive(Debug, Clone)]
pub struct Message {
    pub msg_type: MessageType,
    pub content: String,
    pub timestamp: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone)]
pub enum MessageType {
    Sent,
    Received,
    System,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct Extension {
    pub id: String,
    pub name: String,
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
    pub manifest_v2_path: Option<String>,
    #[serde(default)]
    pub manifest_v3_path: Option<String>,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize, Default)]
pub struct ExtensionStats {
    pub total: usize,
    pub with_mv3: usize,
    pub with_mv2_only: usize,
    pub failed: usize,
    pub avg_score: f64,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct ExtensionsWithStats {
    pub extensions: Vec<Extension>,
    pub stats: ExtensionStats,
}

pub struct App {
    active_tab: usize,
    tabs: Vec<Box<dyn Tab>>,
    state: AppState,
    tx: mpsc::UnboundedSender<AppEvent>,
    ws_sender: WebSocketSender,
}

impl App {
    pub fn new(tx: mpsc::UnboundedSender<AppEvent>, ws_sender: WebSocketSender) -> Self {
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
            last_message_time: None,
            recent_message_count: 0,
            burst_window_start: None,
            selected_extension_id: None,
        };

        let tabs: Vec<Box<dyn Tab>> = vec![
            Box::new(MigratorTab::new()),
            Box::new(ExplorerTab::new()),
            Box::new(AnalyzerTab::new()),
            Box::new(DatabaseTab::new()),
            Box::new(SettingsTab::new()),
        ];

        Self {
            active_tab: 0,
            tabs,
            state,
            tx,
            ws_sender,
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
            tab.render(f, chunks[1], &self.state);
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

        let tab_names = vec!["Migrator", "Explorer", "Analyzer", "Database", "About"];
        let titles: Vec<Line> = tab_names
            .iter()
            .enumerate()
            .map(|(i, name)| {
                let style = if i == self.active_tab {
                    Style::default()
                        .fg(Color::Cyan)
                        .add_modifier(Modifier::BOLD)
                } else {
                    Style::default().fg(Color::White)
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
                    .title("ExtPorter [Ctrl+C or Ctrl+Q: Quit]"),
            )
            .select(self.active_tab)
            .style(Style::default())
            .highlight_style(
                Style::default()
                    .fg(Color::Cyan)
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
            ConnectionState::Connected => ("●", Color::Green),
            ConnectionState::Connecting if should_show_connecting || !self.state.ws_connected => {
                ("◐", Color::Rgb(255, 165, 0)) // Half-filled dot, orange
            }
            ConnectionState::Connecting => ("●", Color::Green), // Fallback to connected if delay passed
            ConnectionState::Disconnected => ("●", Color::Red),
        };

        let connection_status = Paragraph::new(Line::from(vec![
            Span::raw("Connection "),
            Span::styled(status_text, Style::default().fg(status_color)),
        ]))
        .block(Block::default().borders(Borders::ALL))
        .alignment(Alignment::Center);

        f.render_widget(connection_status, menu_chunks[1]);
    }

    pub fn handle_input(&mut self, key: KeyEvent) -> Result<()> {
        // Tab navigation with numbers 1-5
        match key.code {
            KeyCode::Char('1') => self.active_tab = 0,
            KeyCode::Char('2') => self.active_tab = 1,
            KeyCode::Char('3') => self.active_tab = 2,
            KeyCode::Char('4') => self.active_tab = 3,
            KeyCode::Char('5') => self.active_tab = 4,
            KeyCode::Left if self.active_tab > 0 => self.active_tab -= 1,
            KeyCode::Right if self.active_tab < self.tabs.len() - 1 => self.active_tab += 1,
            _ => {
                // Pass input to active tab
                if let Some(tab) = self.tabs.get_mut(self.active_tab) {
                    tab.handle_input(key, &mut self.state, self.tx.clone())?;
                }
            }
        }
        Ok(())
    }

    /// Returns true if the current active tab wants to handle Esc itself
    pub fn active_tab_handles_esc(&self) -> bool {
        self.tabs
            .get(self.active_tab)
            .map(|tab| tab.handles_esc())
            .unwrap_or(false)
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

        // If user is scrolled up, increment scroll offset to maintain view position
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

        self.state.messages.push(Message {
            msg_type: MessageType::System,
            content: "Disconnected from Migration Server".to_string(),
            timestamp: chrono::Utc::now(),
        });
    }

    pub fn handle_websocket_message(&mut self, msg: String) {
        // Try to parse as JSON first for database responses
        if let Ok(json_msg) = serde_json::from_str::<serde_json::Value>(&msg) {
            if json_msg.get("type").and_then(|v| v.as_str()) == Some("db_response") {
                if let Some(id) = json_msg.get("id").and_then(|v| v.as_str()) {
                    if id == "get_extensions" {
                        if let Some(result) = json_msg.get("result") {
                            // Try to parse as ExtensionsWithStats first
                            if let Ok(data) =
                                serde_json::from_value::<ExtensionsWithStats>(result.clone())
                            {
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
                                return;
                            }

                            // Fallback: Parse as plain extension array
                            match serde_json::from_value::<Vec<Extension>>(result.clone()) {
                                Ok(extensions) => {
                                    let count = extensions.len();
                                    self.state.extensions = extensions;

                                    // Add a message about loaded extensions
                                    if self.state.message_scroll_offset > 0 {
                                        self.state.message_scroll_offset += 1;
                                    }

                                    self.state.messages.push(Message {
                                        msg_type: MessageType::System,
                                        content: format!(
                                            "✓ Loaded {} extensions from database",
                                            count
                                        ),
                                        timestamp: chrono::Utc::now(),
                                    });
                                    return;
                                }
                                Err(e) => {
                                    // Log parse error
                                    if self.state.message_scroll_offset > 0 {
                                        self.state.message_scroll_offset += 1;
                                    }

                                    self.state.messages.push(Message {
                                        msg_type: MessageType::System,
                                        content: format!("Error parsing extensions: {}", e),
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
                self.state.migration_running = status.to_lowercase() == "running";
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

        self.state.messages.push(Message {
            msg_type: MessageType::System,
            content: format!("Server Error: {}", err),
            timestamp: chrono::Utc::now(),
        });
    }
}
