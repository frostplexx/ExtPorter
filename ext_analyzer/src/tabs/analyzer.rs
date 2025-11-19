use anyhow::Result;
use crossterm::event::{KeyCode, KeyEvent};
use ratatui::{
    layout::{Constraint, Direction, Layout},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, List, ListItem, Paragraph},
    Frame,
};
use tokio::sync::mpsc;

use crate::app::{AppEvent, AppState};

pub struct AnalyzerTab {
    search_query: String,
    sort_by: SortBy,
    mv2_browser_running: bool,
    mv3_browser_running: bool,
    event_count: u32,
    registered_listeners: Vec<String>,
}

#[derive(Clone, Copy)]
enum SortBy {
    Interestingness,
    Name,
    Version,
}

impl AnalyzerTab {
    pub fn new() -> Self {
        Self {
            search_query: String::new(),
            sort_by: SortBy::Interestingness,
            mv2_browser_running: false,
            mv3_browser_running: false,
            event_count: 0,
            registered_listeners: vec![
                "contextMenus".to_string(),
                "onClick".to_string(),
                "onBeforeRequest".to_string(),
            ],
        }
    }
}

impl super::Tab for AnalyzerTab {
    fn render(&mut self, f: &mut Frame, area: ratatui::layout::Rect, state: &AppState) {
        self.render_comparison_mode(f, area, state);
    }

    fn handle_input(
        &mut self,
        key: KeyEvent,
        state: &mut AppState,
        tx: mpsc::UnboundedSender<AppEvent>,
    ) -> Result<()> {
        return self.handle_comparison_input(key, state, tx);
    }
}

// Helper methods for AnalyzerTab
impl AnalyzerTab {
    fn render_comparison_mode(
        &mut self,
        f: &mut Frame,
        area: ratatui::layout::Rect,
        state: &AppState,
    ) {
        let chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Min(0),
                Constraint::Length(3),
                Constraint::Length(1),
            ])
            .split(area);

        // Main area: split into left, center, and right
        let main_chunks = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([
                Constraint::Percentage(20), // Left: V2/V3 cards
                Constraint::Percentage(50), // Center: Extension details
                Constraint::Percentage(30), // Right: Registered listeners
            ])
            .split(chunks[0]);

        // Get selected extension by ID from AppState
        let selected_ext = if let Some(ref ext_id) = state.selected_extension_id {
            state.extensions.iter().find(|e| e.id == *ext_id)
        } else {
            None
        };

        // LEFT PANEL: V2 and V3 cards vertically stacked
        let left_chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints([Constraint::Percentage(50), Constraint::Percentage(50)])
            .split(main_chunks[0]);

        // V2 Card
        let v2_lines = vec![
            Line::from(Span::styled(
                if self.mv2_browser_running {
                    "● Running"
                } else {
                    "○ Stopped"
                },
                Style::default().fg(if self.mv2_browser_running {
                    Color::Green
                } else {
                    Color::Red
                }),
            )),
            Line::from(Span::raw("")),
            Line::from(Span::styled(
                format!("Events: {}", self.event_count),
                Style::default().fg(Color::Gray),
            )),
        ];

        let v2_panel = Paragraph::new(v2_lines).block(
            Block::default()
                .borders(Borders::ALL)
                .title("V2")
                .border_style(Style::default().fg(Color::Blue)),
        );

        f.render_widget(v2_panel, left_chunks[0]);

        // V3 Card
        let v3_lines = vec![
            Line::from(Span::styled(
                if self.mv3_browser_running {
                    "● Running"
                } else {
                    "○ Stopped"
                },
                Style::default().fg(if self.mv3_browser_running {
                    Color::Green
                } else {
                    Color::Red
                }),
            )),
            Line::from(Span::raw("")),
            Line::from(Span::styled(
                format!("Events: {}", self.event_count),
                Style::default().fg(Color::Gray),
            )),
        ];

        let v3_panel = Paragraph::new(v3_lines).block(
            Block::default()
                .borders(Borders::ALL)
                .title("V3")
                .border_style(Style::default().fg(Color::Red)),
        );

        f.render_widget(v3_panel, left_chunks[1]);

        // CENTER PANEL: Extension details with icon placeholders
        if let Some(ext) = selected_ext {
            let center_chunks = Layout::default()
                .direction(Direction::Vertical)
                .constraints([
                    Constraint::Length(3), // Extension name
                    Constraint::Min(0),    // Icon area
                ])
                .split(main_chunks[1]);

            // Extension name header
            let name_text = Paragraph::new(Line::from(vec![Span::styled(
                &ext.name,
                Style::default()
                    .fg(Color::Cyan)
                    .add_modifier(Modifier::BOLD),
            )]))
            .block(Block::default().borders(Borders::ALL));
            f.render_widget(name_text, center_chunks[0]);

            // Icon placeholders area
            let icon_chunks = Layout::default()
                .direction(Direction::Horizontal)
                .constraints([
                    Constraint::Percentage(33),
                    Constraint::Percentage(33),
                    Constraint::Percentage(34),
                ])
                .split(center_chunks[1]);

            // Three icon placeholders
            for (i, chunk) in icon_chunks.iter().enumerate() {
                let icon_content = vec![
                    Line::from(Span::raw("")),
                    Line::from(Span::styled("  ___", Style::default().fg(Color::Gray))),
                    Line::from(Span::styled(" |   |", Style::default().fg(Color::Gray))),
                    Line::from(Span::styled(" |___|", Style::default().fg(Color::Gray))),
                    Line::from(Span::raw("")),
                    Line::from(Span::styled(
                        format!("  Icon {}", i + 1),
                        Style::default().fg(Color::DarkGray),
                    )),
                ];

                let icon =
                    Paragraph::new(icon_content).block(Block::default().borders(Borders::ALL));
                f.render_widget(icon, *chunk);
            }
        } else {
            let no_ext = Paragraph::new(vec![Line::from(Span::styled(
                "No extension selected",
                Style::default().fg(Color::Gray).add_modifier(Modifier::DIM),
            ))])
            .block(Block::default().borders(Borders::ALL).title("Extension"));
            f.render_widget(no_ext, main_chunks[1]);
        };

        // RIGHT PANEL: Registered Listeners
        let listener_items: Vec<Line> = self
            .registered_listeners
            .iter()
            .map(|listener| {
                Line::from(vec![
                    Span::raw("  • "),
                    Span::styled(listener, Style::default().fg(Color::Yellow)),
                ])
            })
            .collect();

        let listeners_panel = Paragraph::new(listener_items).block(
            Block::default()
                .borders(Borders::ALL)
                .title("Registered Listeners")
                .border_style(Style::default().fg(Color::Magenta)),
        );

        f.render_widget(listeners_panel, main_chunks[2]);

        // Bottom status bar - event data counter
        let status_text = if let Some(ext) = selected_ext {
            Line::from(vec![
                Span::styled("Extension ID: ", Style::default().fg(Color::Cyan)),
                Span::raw(&ext.id),
                Span::styled(" • ", Style::default().fg(Color::Gray)),
                Span::styled(
                    format!("Events Logged: {}", self.event_count),
                    Style::default().fg(Color::Green),
                ),
            ])
        } else {
            Line::from(Span::raw("No extension selected"))
        };

        let status = Paragraph::new(status_text).block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Color::DarkGray)),
        );

        f.render_widget(status, chunks[1]);

        // Help text
        let help_text = if state.selected_extension_id.is_some() {
            "O: Launch Both • Q: Close Both"
        } else {
            "No extension loaded • Go to Explorer tab and press 'A' to send an extension here"
        };
        let help = Paragraph::new(help_text).style(Style::default().add_modifier(Modifier::DIM));

        f.render_widget(help, chunks[2]);
    }
}

// Helper methods for AnalyzerTab
impl AnalyzerTab {
    fn handle_comparison_input(
        &mut self,
        key: KeyEvent,
        state: &mut AppState,
        tx: mpsc::UnboundedSender<AppEvent>,
    ) -> Result<()> {
        match key.code {
            KeyCode::Char('o') | KeyCode::Char('O') => {
                // Launch both browsers using the selected extension from AppState
                if let Some(ref ext_id) = state.selected_extension_id {
                    if let Some(_ext) = state.extensions.iter().find(|e| e.id == *ext_id) {
                        let msg = format!("LAUNCH_DUAL:{}", ext_id);
                        let _ = tx.send(AppEvent::SendWebSocketMessage(msg));
                        self.mv2_browser_running = true;
                        self.mv3_browser_running = true;
                    }
                }
            }
            KeyCode::Char('q') | KeyCode::Char('Q') => {
                // Close both browsers
                self.mv2_browser_running = false;
                self.mv3_browser_running = false;
                let _ = tx.send(AppEvent::SendWebSocketMessage("CLOSE_BROWSERS".to_string()));
            }
            _ => {}
        }
        Ok(())
    }
}
