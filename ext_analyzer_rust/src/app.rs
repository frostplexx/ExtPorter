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

use crate::tabs::{
    analyzer::AnalyzerTab, database::DatabaseTab, explorer::ExplorerTab, migrator::MigratorTab,
    settings::SettingsTab, Tab,
};

#[derive(Debug, Clone)]
pub enum AppEvent {
    Input(KeyEvent),
    WebSocketConnected,
    WebSocketDisconnected,
    WebSocketMessage(String),
    WebSocketError(String),
    Quit,
}

pub struct AppState {
    pub ws_connected: bool,
    pub db_connected: bool,
    pub migration_running: bool,
    pub messages: Vec<Message>,
    pub extensions: Vec<Extension>,
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
    pub version: String,
    #[serde(default)]
    pub mv2_extension_id: Option<String>,
    #[serde(default)]
    pub mv3_extension_id: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub interestingness: Option<f64>,
    #[serde(default)]
    pub migration_time_seconds: Option<f64>,
    #[serde(default)]
    pub input_path: Option<String>,
}

pub struct App {
    active_tab: usize,
    tabs: Vec<Box<dyn Tab>>,
    state: AppState,
    tx: mpsc::UnboundedSender<AppEvent>,
}

impl App {
    pub fn new(tx: mpsc::UnboundedSender<AppEvent>) -> Self {
        let state = AppState {
            ws_connected: false,
            db_connected: false,
            migration_running: false,
            messages: Vec::new(),
            extensions: Vec::new(),
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
            .block(Block::default().borders(Borders::ALL).title("ExtPorter"))
            .select(self.active_tab)
            .style(Style::default())
            .highlight_style(
                Style::default()
                    .fg(Color::Cyan)
                    .add_modifier(Modifier::BOLD),
            );

        f.render_widget(tabs, area);
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

    pub fn handle_websocket_connected(&mut self) {
        self.state.ws_connected = true;
        self.state.messages.push(Message {
            msg_type: MessageType::System,
            content: "Connected to Migration Server".to_string(),
            timestamp: chrono::Utc::now(),
        });
    }

    pub fn handle_websocket_disconnected(&mut self) {
        self.state.ws_connected = false;
        self.state.db_connected = false;
        self.state.messages.push(Message {
            msg_type: MessageType::System,
            content: "Disconnected from migration server".to_string(),
            timestamp: chrono::Utc::now(),
        });
    }

    pub fn handle_websocket_message(&mut self, msg: String) {
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
            (MessageType::System, msg.strip_prefix("STDOUT: ").unwrap().to_string())
        } else if msg.starts_with("STDERR: ") {
            (MessageType::System, format!("⚠ {}", msg.strip_prefix("STDERR: ").unwrap()))
        } else {
            (MessageType::Received, msg)
        };

        // Normalize content (single line)
        let content = content.replace('\n', " ").split_whitespace().collect::<Vec<_>>().join(" ");

        self.state.messages.push(Message {
            msg_type,
            content,
            timestamp: chrono::Utc::now(),
        });
    }

    pub fn handle_websocket_error(&mut self, err: String) {
        self.state.messages.push(Message {
            msg_type: MessageType::System,
            content: format!("Server Error: {}", err),
            timestamp: chrono::Utc::now(),
        });
    }
}
