use anyhow::Result;
use crossterm::event::KeyEvent;
use ratatui::{
    layout::{Constraint, Direction, Layout},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Paragraph},
    Frame,
};
use tokio::sync::mpsc;

use crate::app::{AppEvent, AppState};

pub struct SettingsTab;

impl SettingsTab {
    pub fn new() -> Self {
        Self
    }
}

impl super::Tab for SettingsTab {
    fn render(&mut self, f: &mut Frame, area: ratatui::layout::Rect, _state: &AppState) {
        let chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Length(2),
                Constraint::Length(5),
                Constraint::Length(5),
                Constraint::Length(7),
                Constraint::Min(0),
            ])
            .split(area);

        // Title
        let title = Paragraph::new(Line::from(Span::styled(
            "⚙ Settings & Configuration",
            Style::default()
                .fg(Color::Cyan)
                .add_modifier(Modifier::BOLD),
        )));
        f.render_widget(title, chunks[0]);

        // Get the configured WebSocket URL
        let ws_url = std::env::var("WS_URL").unwrap_or_else(|_| "ws://localhost:8080".to_string());

        // Server configuration
        let server_config = Paragraph::new(vec![
            Line::from(Span::styled(
                "Migration Server",
                Style::default().add_modifier(Modifier::BOLD | Modifier::UNDERLINED),
            )),
            Line::from(vec![
                Span::styled("Server URL:", Style::default().fg(Color::Cyan)),
                Span::raw(format!(" {}", ws_url)),
            ]),
        ])
        .block(Block::default().borders(Borders::NONE));
        f.render_widget(server_config, chunks[1]);

        // Database configuration
        let db_config = Paragraph::new(vec![
            Line::from(Span::styled(
                "Database",
                Style::default().add_modifier(Modifier::BOLD | Modifier::UNDERLINED),
            )),
            Line::from(vec![
                Span::styled("Type:", Style::default().fg(Color::Cyan)),
                Span::raw(" MongoDB"),
            ]),
            Line::from(vec![
                Span::styled("Host:", Style::default().fg(Color::Cyan)),
                Span::raw(" localhost:27017"),
            ]),
        ])
        .block(Block::default().borders(Borders::NONE));
        f.render_widget(db_config, chunks[2]);

        // Features
        let features = Paragraph::new(vec![
            Line::from(Span::styled(
                "Available Features",
                Style::default().add_modifier(Modifier::BOLD | Modifier::UNDERLINED),
            )),
            Line::from(Span::styled(
                "✓ WebSocket Migration Server",
                Style::default().fg(Color::Green),
            )),
            Line::from(Span::styled(
                "✓ Extension Analysis",
                Style::default().fg(Color::Green),
            )),
            Line::from(Span::styled(
                "✓ Real-time Log Streaming",
                Style::default().fg(Color::Green),
            )),
        ])
        .block(Block::default().borders(Borders::NONE));
        f.render_widget(features, chunks[3]);

        // About
        let about = Paragraph::new(vec![
            Line::from(Span::styled(
                "About",
                Style::default().add_modifier(Modifier::BOLD | Modifier::UNDERLINED),
            )),
            Line::from(Span::styled(
                "Extension Analyzer & Migrator v1.0.0 (Rust)",
                Style::default().add_modifier(Modifier::DIM),
            )),
            Line::from(Span::styled(
                "Migrate Chrome Extensions from Manifest V2 to V3",
                Style::default().add_modifier(Modifier::DIM),
            )),
            Line::from(""),
            Line::from(Span::styled(
                "Built with Rust and Ratatui",
                Style::default().fg(Color::Cyan).add_modifier(Modifier::DIM),
            )),
        ])
        .block(Block::default().borders(Borders::NONE));
        f.render_widget(about, chunks[4]);
    }

    fn handle_input(
        &mut self,
        _key: KeyEvent,
        _state: &mut AppState,
        _tx: mpsc::UnboundedSender<AppEvent>,
    ) -> Result<()> {
        Ok(())
    }
}
