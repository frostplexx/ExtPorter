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

pub struct ExplorerTab {
    selected_index: usize,
    scroll_offset: usize,
    search_query: String,
    sort_by: SortBy,
    search_focused: bool,
    event_count: u32,
    registered_listeners: Vec<String>,
}

#[derive(Clone, Copy)]
enum SortBy {
    Interestingness,
    Name,
    Version,
}

impl ExplorerTab {
    pub fn new() -> Self {
        Self {
            selected_index: 0,
            scroll_offset: 0,
            search_query: String::new(),
            sort_by: SortBy::Interestingness,
            search_focused: false,
            event_count: 0,
            registered_listeners: vec![
                "contextMenus".to_string(),
                "onClick".to_string(),
                "onBeforeRequest".to_string(),
            ],
        }
    }
}

impl super::Tab for ExplorerTab {
    fn render(
        &mut self,
        f: &mut Frame,
        area: ratatui::layout::Rect,
        state: &AppState,
        _tx: mpsc::UnboundedSender<AppEvent>,
    ) {
        self.render_list_mode(f, area, state);
    }

    fn handles_esc(&self) -> bool {
        // Only handle Esc ourselves if search is focused
        self.search_focused
    }

    fn handle_input(
        &mut self,
        key: KeyEvent,
        state: &mut AppState,
        tx: mpsc::UnboundedSender<AppEvent>,
    ) -> Result<()> {
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

        // Handle search field focus/unfocus
        match key.code {
            KeyCode::Char('/') if !self.search_focused => {
                // Enter search mode
                self.search_focused = true;
                return Ok(());
            }
            KeyCode::Esc if self.search_focused => {
                // Exit search mode
                self.search_focused = false;
                return Ok(());
            }
            KeyCode::Enter if self.search_focused => {
                // Exit search mode (keep the query)
                self.search_focused = false;
                return Ok(());
            }
            _ => {}
        }

        // If search is focused, only handle text input and backspace
        if self.search_focused {
            match key.code {
                KeyCode::Char(c) => {
                    self.search_query.push(c);
                    self.selected_index = 0;
                    self.scroll_offset = 0;
                }
                KeyCode::Backspace => {
                    self.search_query.pop();
                    self.selected_index = 0;
                    self.scroll_offset = 0;
                }
                _ => {}
            }
            return Ok(());
        }

        // Normal mode shortcuts (only active when search is NOT focused)
        match key.code {
            KeyCode::Up => {
                if self.selected_index > 0 {
                    self.selected_index -= 1;
                    // Adjust scroll if selected item is above visible area
                    if self.selected_index < self.scroll_offset {
                        self.scroll_offset = self.selected_index;
                    }
                }
            }
            KeyCode::Down => {
                if self.selected_index < filtered_count.saturating_sub(1) {
                    self.selected_index += 1;
                    // Adjust scroll if selected item is below visible area
                    // We'll calculate the visible height in the render function
                }
            }
            KeyCode::PageUp => {
                self.selected_index = self.selected_index.saturating_sub(20);
                self.scroll_offset = self.scroll_offset.saturating_sub(20);
            }
            KeyCode::PageDown => {
                self.selected_index =
                    (self.selected_index + 20).min(filtered_count.saturating_sub(1));
            }
            KeyCode::Home => {
                self.selected_index = 0;
                self.scroll_offset = 0;
            }
            KeyCode::End => {
                self.selected_index = filtered_count.saturating_sub(1);
            }
            KeyCode::Char('s') | KeyCode::Char('S') => {
                self.sort_by = match self.sort_by {
                    SortBy::Interestingness => SortBy::Name,
                    SortBy::Name => SortBy::Version,
                    SortBy::Version => SortBy::Interestingness,
                };
            }
            KeyCode::Char('r') | KeyCode::Char('R') => {
                // Refresh extensions list from database
                let extensions_request = r#"{"type":"db_query","id":"get_extensions","method":"getExtensionsWithStats","params":{}}"#;
                let _ = tx.send(AppEvent::SendWebSocketMessage(
                    extensions_request.to_string(),
                ));
            }
            KeyCode::Char('c') | KeyCode::Char('C') => {
                // Clear search
                self.search_query.clear();
                self.selected_index = 0;
                self.scroll_offset = 0;
            }
            KeyCode::Char('a') | KeyCode::Char('A') => {
                // Send selected extension to Analyzer tab
                // First, get the filtered extensions to find the actual selected extension
                let filtered_extensions: Vec<_> = state
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
                            || ext.tags.iter().any(|t| {
                                t.to_lowercase().contains(&self.search_query.to_lowercase())
                            })
                    })
                    .collect();

                if let Some(ext) = filtered_extensions.get(self.selected_index) {
                    state.selected_extension_id = Some(ext.id.clone());
                    // Switch to Analyzer tab (tab index 2)
                    let _ = tx.send(AppEvent::SwitchToTab(2));
                }
            }
            _ => {}
        }
        Ok(())
    }

    fn as_any_mut(&mut self) -> &mut dyn std::any::Any {
        self
    }
}

// Helper methods for ExplorerTab
impl ExplorerTab {
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

        // Statistics bar - use pre-calculated stats from server
        let stats = Paragraph::new(Line::from(vec![
            Span::styled("Total:", Style::default().fg(Color::Cyan)),
            Span::raw(format!(" {} ", state.extension_stats.total)),
            Span::styled("• MV3:", Style::default().fg(Color::Green)),
            Span::raw(format!(" {} ", state.extension_stats.with_mv3)),
            Span::styled("• MV2 Only:", Style::default().fg(Color::Yellow)),
            Span::raw(format!(" {} ", state.extension_stats.with_mv2_only)),
            Span::styled("• Failed:", Style::default().fg(Color::Red)),
            Span::raw(format!(" {} ", state.extension_stats.failed)),
            Span::styled("• Avg Score:", Style::default().fg(Color::Magenta)),
            Span::raw(format!(" {:.1}", state.extension_stats.avg_score)),
        ]));

        f.render_widget(stats, chunks[0]);

        // Search bar
        let sort_text = match self.sort_by {
            SortBy::Interestingness => "interestingness",
            SortBy::Name => "name",
            SortBy::Version => "version",
        };

        // Show cursor only when search is focused
        let cursor = if self.search_focused {
            Span::styled("█", Style::default().fg(Color::White))
        } else {
            Span::raw(" ")
        };

        // Different border style based on focus
        let border_style = if self.search_focused {
            Style::default()
                .fg(Color::Yellow)
                .add_modifier(Modifier::BOLD)
        } else {
            Style::default().fg(Color::Gray)
        };

        let search_bar = Paragraph::new(Line::from(vec![
            Span::styled("Search: ", Style::default().fg(Color::Gray)),
            Span::raw(&self.search_query),
            cursor,
            Span::styled(" • Sort by: ", Style::default().fg(Color::Gray)),
            Span::styled(sort_text, Style::default().fg(Color::Cyan)),
        ]))
        .block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(border_style),
        );

        f.render_widget(search_bar, chunks[1]);

        // Extension list with details
        let main_chunks = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([Constraint::Percentage(50), Constraint::Percentage(50)])
            .split(chunks[2]);

        // Filter extensions (don't sort yet - we'll sort only visible ones)
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

        // Sort filtered extensions
        // Note: Server already sends extensions pre-sorted by interestingness
        match self.sort_by {
            SortBy::Interestingness => {
                // Already sorted by server, but re-sort if search filtered the list
                if !self.search_query.is_empty() {
                    filtered_extensions.sort_by(|a, b| {
                        b.interestingness
                            .unwrap_or(0.0)
                            .partial_cmp(&a.interestingness.unwrap_or(0.0))
                            .unwrap()
                    });
                }
            }
            SortBy::Name => {
                filtered_extensions.sort_by(|a, b| a.name.cmp(&b.name));
            }
            SortBy::Version => {
                filtered_extensions.sort_by(|a, b| {
                    a.version
                        .as_deref()
                        .unwrap_or("")
                        .cmp(b.version.as_deref().unwrap_or(""))
                });
            }
        }

        let filtered_count = filtered_extensions.len();

        // Calculate visible window for virtualization
        let list_height = main_chunks[0].height.saturating_sub(2) as usize; // Subtract borders

        // Adjust scroll offset to keep selected item visible
        if self.selected_index >= self.scroll_offset + list_height {
            self.scroll_offset = self.selected_index.saturating_sub(list_height - 1);
        }
        if self.selected_index < self.scroll_offset {
            self.scroll_offset = self.selected_index;
        }

        let visible_start = self.scroll_offset;
        let visible_end = (self.scroll_offset + list_height).min(filtered_count);

        // Only render visible items
        let items: Vec<ListItem> = filtered_extensions
            .iter()
            .enumerate()
            .skip(visible_start)
            .take(visible_end - visible_start)
            .map(|(idx, ext)| {
                let is_selected = idx == self.selected_index;
                let prefix = if is_selected { "▶ " } else { "  " };
                // Unicode-safe truncation: count characters, not bytes
                let name_truncated = if ext.name.chars().count() > 30 {
                    let truncated: String = ext.name.chars().take(30).collect();
                    format!("{}...", truncated)
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

        let list_title = if filtered_count > list_height {
            format!(
                "Extensions ({}-{} of {})",
                visible_start + 1,
                visible_end,
                filtered_count
            )
        } else {
            format!("Extensions ({})", filtered_count)
        };

        let list = List::new(items).block(Block::default().borders(Borders::ALL).title(list_title));

        f.render_widget(list, main_chunks[0]);

        // Details panel
        let selected_ext = filtered_extensions.get(self.selected_index);
        let details_text = if let Some(ext) = selected_ext {
            let mut lines = vec![
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
                    Span::raw(ext.version.as_deref().unwrap_or("N/A")),
                ]),
                Line::from(vec![
                    Span::styled(
                        "MV3 ID: ",
                        Style::default()
                            .fg(Color::Cyan)
                            .add_modifier(Modifier::BOLD),
                    ),
                    Span::raw(ext.mv3_extension_id.as_deref().unwrap_or("N/A")),
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
                Line::from(""),
                Line::from(vec![Span::styled(
                    "Tags: ",
                    Style::default()
                        .fg(Color::Cyan)
                        .add_modifier(Modifier::BOLD),
                )]),
                Line::from(if ext.tags.is_empty() {
                    Span::styled("No tags", Style::default().fg(Color::Gray))
                } else {
                    Span::raw(ext.tags.join(", "))
                }),
            ];

            // Add analyzer status indicator
            if let Some(ref selected_id) = state.selected_extension_id {
                if selected_id == &ext.id {
                    lines.push(Line::from(""));
                    lines.push(Line::from(vec![
                        Span::styled("⚡ ", Style::default().fg(Color::Yellow)),
                        Span::styled(
                            "Loaded in Analyzer",
                            Style::default()
                                .fg(Color::Yellow)
                                .add_modifier(Modifier::BOLD),
                        ),
                    ]));
                }
            }

            lines
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
        let help_text = if self.search_focused {
            "Type to search • Backspace: Delete • Enter/Esc: Exit search"
        } else {
            "↑/↓/PgUp/PgDn/Home/End: Navigate • /: Search • S: Sort • C: Clear • R: Refresh • A: Send to Analyzer"
        };

        let help = Paragraph::new(help_text).style(Style::default().add_modifier(Modifier::DIM));

        f.render_widget(help, chunks[3]);
    }
}
