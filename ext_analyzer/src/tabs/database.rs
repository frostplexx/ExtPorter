use anyhow::Result;
use crossterm::event::{KeyCode, KeyEvent};
use ratatui::{
    layout::{Constraint, Direction, Layout},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Paragraph},
    Frame,
};
use tokio::sync::mpsc;

use crate::app::{AppEvent, AppState};

pub struct DatabaseTab {
    view_mode: ViewMode,
}

enum ViewMode {
    Collections,
    Query,
}

impl DatabaseTab {
    pub fn new() -> Self {
        Self {
            view_mode: ViewMode::Collections,
        }
    }
}

impl super::Tab for DatabaseTab {
    fn render(
        &mut self,
        f: &mut Frame,
        area: ratatui::layout::Rect,
        state: &AppState,
        _tx: mpsc::UnboundedSender<AppEvent>,
    ) {
        let chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Length(1),
                Constraint::Min(0),
                Constraint::Length(1),
            ])
            .split(area);

        // Database status
        let db_status = if state.db_connected {
            Span::styled("connected", Style::default().fg(Color::Green))
        } else {
            Span::styled("disconnected", Style::default().fg(Color::Red))
        };

        let mode_text = match self.view_mode {
            ViewMode::Collections => "Browse",
            ViewMode::Query => "Query",
        };

        let status = Paragraph::new(Line::from(vec![
            Span::styled("Database:", Style::default().fg(Color::Cyan)),
            Span::raw(" "),
            db_status,
            Span::raw(" • "),
            Span::styled("Mode:", Style::default().fg(Color::Cyan)),
            Span::raw(" "),
            Span::styled(mode_text, Style::default().fg(Color::Magenta)),
        ]));

        f.render_widget(status, chunks[0]);

        // Main content area
        let main_chunks = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([Constraint::Percentage(30), Constraint::Percentage(70)])
            .split(chunks[1]);

        // Collections panel (left)
        let collections_text = vec![
            Line::from("extensions (mock data)"),
            Line::from("logs (mock data)"),
        ];

        let collections = Paragraph::new(collections_text).block(
            Block::default()
                .borders(Borders::ALL)
                .title("Collections")
                .border_style(Style::default().fg(Color::Gray)),
        );

        f.render_widget(collections, main_chunks[0]);

        // Query/Results panel (right)
        let query_text = vec![
            Line::from(vec![
                Span::styled("Query: ", Style::default().fg(Color::Gray)),
                Span::styled("{}", Style::default().fg(Color::Cyan)),
            ]),
            Line::from(""),
            Line::from(Span::styled(
                "Database querying functionality is available in TypeScript version.",
                Style::default().fg(Color::Yellow),
            )),
            Line::from(""),
            Line::from(Span::styled(
                "This Rust client provides a streamlined interface focused on",
                Style::default().fg(Color::Gray).add_modifier(Modifier::DIM),
            )),
            Line::from(Span::styled(
                "core migration monitoring and extension browsing.",
                Style::default().fg(Color::Gray).add_modifier(Modifier::DIM),
            )),
        ];

        let query_panel = Paragraph::new(query_text).block(
            Block::default()
                .borders(Borders::ALL)
                .title("Query & Results")
                .border_style(Style::default().fg(Color::Gray)),
        );

        f.render_widget(query_panel, main_chunks[1]);

        // Help text
        let help_text = match self.view_mode {
            ViewMode::Collections => {
                "M: Toggle mode • Database features available in TypeScript version"
            }
            ViewMode::Query => "M: Toggle mode • ESC: Back",
        };

        let help = Paragraph::new(help_text).style(Style::default().add_modifier(Modifier::DIM));

        f.render_widget(help, chunks[2]);
    }

    fn handle_input(
        &mut self,
        key: KeyEvent,
        _state: &mut AppState,
        _tx: mpsc::UnboundedSender<AppEvent>,
    ) -> Result<()> {
        match key.code {
            KeyCode::Char('m') => {
                self.view_mode = match self.view_mode {
                    ViewMode::Collections => ViewMode::Query,
                    ViewMode::Query => ViewMode::Collections,
                };
            }
            _ => {}
        }
        Ok(())
    }

    fn as_any_mut(&mut self) -> &mut dyn std::any::Any {
        self
    }
}
