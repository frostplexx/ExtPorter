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
    selected_index: usize,
    search_query: String,
    sort_by: SortBy,
    comparison_mode: bool,
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
            selected_index: 0,
            search_query: String::new(),
            sort_by: SortBy::Interestingness,
            comparison_mode: false,
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
        if self.comparison_mode {
            self.render_comparison_mode(f, area, state);
        } else {
            self.render_list_mode(f, area, state);
        }
    }

    fn handle_input(
        &mut self,
        key: KeyEvent,
        state: &mut AppState,
        tx: mpsc::UnboundedSender<AppEvent>,
    ) -> Result<()> {
        if self.comparison_mode {
            return self.handle_comparison_input(key, state, tx);
        }

        let filtered_count = state
            .extensions
            .iter()
            .filter(|ext| {
                self.search_query.is_empty()
                    || ext
                        .name
                        .to_lowercase()
                        .contains(&self.search_query.to_lowercase())
                    || ext
                        .id
                        .to_lowercase()
                        .contains(&self.search_query.to_lowercase())
                    || ext
                        .tags
                        .iter()
                        .any(|t| t.to_lowercase().contains(&self.search_query.to_lowercase()))
            })
            .count();

        match key.code {
            KeyCode::Up => {
                if self.selected_index > 0 {
                    self.selected_index -= 1;
                }
            }
            KeyCode::Down => {
                if self.selected_index < filtered_count.saturating_sub(1) {
                    self.selected_index += 1;
                }
            }
            KeyCode::Char('s') => {
                self.sort_by = match self.sort_by {
                    SortBy::Interestingness => SortBy::Name,
                    SortBy::Name => SortBy::Version,
                    SortBy::Version => SortBy::Interestingness,
                };
            }
            KeyCode::Char('c') => {
                // Enter comparison mode
                self.comparison_mode = true;
            }
            KeyCode::Char(c) if !matches!(c, '1'..='5' | 's' | 'c') => {
                self.search_query.push(c);
                self.selected_index = 0;
            }
            KeyCode::Backspace => {
                self.search_query.pop();
                self.selected_index = 0;
            }
            _ => {}
        }
        Ok(())
    }
}

// Helper methods for AnalyzerTab
impl AnalyzerTab {
    fn render_list_mode(&mut self, f: &mut Frame, area: ratatui::layout::Rect, state: &AppState) {
        let chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Length(1),
                Constraint::Length(3),
                Constraint::Min(0),
                Constraint::Length(1),
            ])
            .split(area);

        // Statistics bar
        let total = state.extensions.len();
        let with_mv3 = state
            .extensions
            .iter()
            .filter(|e| e.mv3_extension_id.is_some())
            .count();
        let with_mv2_only = total - with_mv3;
        let failed = state
            .extensions
            .iter()
            .filter(|e| e.tags.contains(&"migration-failed".to_string()))
            .count();
        let avg_score = if total > 0 {
            state
                .extensions
                .iter()
                .filter_map(|e| e.interestingness)
                .sum::<f64>()
                / total as f64
        } else {
            0.0
        };

        let stats = Paragraph::new(Line::from(vec![
            Span::styled("Total:", Style::default().fg(Color::Cyan)),
            Span::raw(format!(" {} ", total)),
            Span::styled("• MV3:", Style::default().fg(Color::Green)),
            Span::raw(format!(" {} ", with_mv3)),
            Span::styled("• MV2 Only:", Style::default().fg(Color::Yellow)),
            Span::raw(format!(" {} ", with_mv2_only)),
            Span::styled("• Failed:", Style::default().fg(Color::Red)),
            Span::raw(format!(" {} ", failed)),
            Span::styled("• Avg Score:", Style::default().fg(Color::Magenta)),
            Span::raw(format!(" {:.1}", avg_score)),
        ]));

        f.render_widget(stats, chunks[0]);

        // Search bar
        let sort_text = match self.sort_by {
            SortBy::Interestingness => "interestingness",
            SortBy::Name => "name",
            SortBy::Version => "version",
        };

        let search_bar = Paragraph::new(Line::from(vec![
            Span::styled("Search: ", Style::default().fg(Color::Gray)),
            Span::raw(&self.search_query),
            Span::styled("█", Style::default().fg(Color::Gray)),
            Span::styled(" • Sort by: ", Style::default().fg(Color::Gray)),
            Span::styled(sort_text, Style::default().fg(Color::Cyan)),
        ]))
        .block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Color::Cyan)),
        );

        f.render_widget(search_bar, chunks[1]);

        // Extension list with details
        let main_chunks = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([Constraint::Percentage(50), Constraint::Percentage(50)])
            .split(chunks[2]);

        // Filter and sort extensions
        let mut filtered_extensions: Vec<_> = state
            .extensions
            .iter()
            .filter(|ext| {
                self.search_query.is_empty()
                    || ext
                        .name
                        .to_lowercase()
                        .contains(&self.search_query.to_lowercase())
                    || ext
                        .id
                        .to_lowercase()
                        .contains(&self.search_query.to_lowercase())
                    || ext
                        .tags
                        .iter()
                        .any(|t| t.to_lowercase().contains(&self.search_query.to_lowercase()))
            })
            .collect();

        match self.sort_by {
            SortBy::Interestingness => {
                filtered_extensions.sort_by(|a, b| {
                    b.interestingness
                        .unwrap_or(0.0)
                        .partial_cmp(&a.interestingness.unwrap_or(0.0))
                        .unwrap()
                });
            }
            SortBy::Name => {
                filtered_extensions.sort_by(|a, b| a.name.cmp(&b.name));
            }
            SortBy::Version => {
                filtered_extensions.sort_by(|a, b| a.version.cmp(&b.version));
            }
        }

        // Extension list
        let items: Vec<ListItem> = filtered_extensions
            .iter()
            .enumerate()
            .take(15)
            .map(|(idx, ext)| {
                let is_selected = idx == self.selected_index;
                let prefix = if is_selected { "▶ " } else { "  " };
                let name_truncated = if ext.name.len() > 30 {
                    format!("{}...", &ext.name[..30])
                } else {
                    ext.name.clone()
                };

                let has_mv3 = ext.mv3_extension_id.is_some();
                let is_failed = ext.tags.contains(&"migration-failed".to_string());

                let mv3_indicator = if has_mv3 {
                    Span::styled(" ✓", Style::default().fg(Color::Green))
                } else if is_failed {
                    Span::styled(" ✗", Style::default().fg(Color::Red))
                } else {
                    Span::raw("")
                };

                let style = if is_selected {
                    Style::default()
                        .fg(Color::Cyan)
                        .add_modifier(Modifier::BOLD)
                        .bg(Color::Blue)
                } else {
                    Style::default()
                };

                ListItem::new(Line::from(vec![
                    Span::styled(format!("{}{}", prefix, name_truncated), style),
                    mv3_indicator,
                ]))
            })
            .collect();

        let list =
            List::new(items).block(Block::default().borders(Borders::ALL).title("Extensions"));

        f.render_widget(list, main_chunks[0]);

        // Details panel
        let selected_ext = filtered_extensions.get(self.selected_index);
        let details_text = if let Some(ext) = selected_ext {
            vec![
                Line::from(vec![
                    Span::styled(
                        "Name: ",
                        Style::default()
                            .fg(Color::Cyan)
                            .add_modifier(Modifier::BOLD),
                    ),
                    Span::raw(&ext.name),
                ]),
                Line::from(vec![
                    Span::styled(
                        "ID: ",
                        Style::default()
                            .fg(Color::Cyan)
                            .add_modifier(Modifier::BOLD),
                    ),
                    Span::raw(&ext.id),
                ]),
                Line::from(vec![
                    Span::styled(
                        "Version: ",
                        Style::default()
                            .fg(Color::Cyan)
                            .add_modifier(Modifier::BOLD),
                    ),
                    Span::raw(&ext.version),
                ]),
                Line::from(vec![
                    Span::styled(
                        "Interestingness: ",
                        Style::default()
                            .fg(Color::Cyan)
                            .add_modifier(Modifier::BOLD),
                    ),
                    if let Some(score) = ext.interestingness {
                        let color = if score > 80.0 {
                            Color::Green
                        } else if score > 50.0 {
                            Color::Yellow
                        } else {
                            Color::Red
                        };
                        Span::styled(format!("{:.1}", score), Style::default().fg(color))
                    } else {
                        Span::raw("N/A")
                    },
                ]),
            ]
        } else {
            vec![Line::from(Span::styled(
                "Select an extension to view details",
                Style::default().fg(Color::Gray).add_modifier(Modifier::DIM),
            ))]
        };

        let details = Paragraph::new(details_text)
            .block(Block::default().borders(Borders::ALL).title("Details"));

        f.render_widget(details, main_chunks[1]);

        // Help text
        let help = Paragraph::new(
            "↑/↓: Navigate • Type: Search • S: Toggle sort • C: Compare • ESC: Quit",
        )
        .style(Style::default().add_modifier(Modifier::DIM));

        f.render_widget(help, chunks[3]);
    }

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

        // Get selected extension
        let selected_ext = state.extensions.get(self.selected_index);

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
        let help =
            Paragraph::new("O: Launch Both • Q: Close Both • C: Exit Compare Mode • ESC: Quit")
                .style(Style::default().add_modifier(Modifier::DIM));

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
            KeyCode::Char('c') => {
                // Exit comparison mode
                self.comparison_mode = false;
                self.mv2_browser_running = false;
                self.mv3_browser_running = false;
                // Send close message
                let _ = tx.send(AppEvent::SendWebSocketMessage("CLOSE_BROWSERS".to_string()));
            }
            KeyCode::Char('o') => {
                // Launch both browsers
                if let Some(ext) = state.extensions.get(self.selected_index) {
                    let msg = format!("LAUNCH_DUAL:{}", ext.id);
                    let _ = tx.send(AppEvent::SendWebSocketMessage(msg));
                    self.mv2_browser_running = true;
                    self.mv3_browser_running = true;
                }
            }
            KeyCode::Char('q') => {
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
