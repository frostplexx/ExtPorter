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
        }
    }
}

impl super::Tab for AnalyzerTab {
    fn render(&mut self, f: &mut Frame, area: ratatui::layout::Rect, state: &AppState) {
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
        let with_mv3 = state.extensions.iter().filter(|e| e.mv3_extension_id.is_some()).count();
        let with_mv2_only = total - with_mv3;
        let failed = state.extensions.iter().filter(|e| e.tags.contains(&"migration-failed".to_string())).count();
        let avg_score = if total > 0 {
            state.extensions.iter().filter_map(|e| e.interestingness).sum::<f64>() / total as f64
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
        .block(Block::default().borders(Borders::ALL).border_style(Style::default().fg(Color::Cyan)));

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
                    || ext.name.to_lowercase().contains(&self.search_query.to_lowercase())
                    || ext.id.to_lowercase().contains(&self.search_query.to_lowercase())
                    || ext.tags.iter().any(|t| t.to_lowercase().contains(&self.search_query.to_lowercase()))
            })
            .collect();

        match self.sort_by {
            SortBy::Interestingness => {
                filtered_extensions.sort_by(|a, b| {
                    b.interestingness.unwrap_or(0.0).partial_cmp(&a.interestingness.unwrap_or(0.0)).unwrap()
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

        let list = List::new(items)
            .block(Block::default().borders(Borders::ALL).title("Extensions"));

        f.render_widget(list, main_chunks[0]);

        // Details panel
        let selected_ext = filtered_extensions.get(self.selected_index);
        let details_text = if let Some(ext) = selected_ext {
            vec![
                Line::from(vec![
                    Span::styled("Name: ", Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD)),
                    Span::raw(&ext.name),
                ]),
                Line::from(vec![
                    Span::styled("ID: ", Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD)),
                    Span::raw(&ext.id),
                ]),
                Line::from(vec![
                    Span::styled("Version: ", Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD)),
                    Span::raw(&ext.version),
                ]),
                Line::from(vec![
                    Span::styled("Interestingness: ", Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD)),
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
        let help = Paragraph::new("↑/↓: Navigate • Type: Search • S: Toggle sort • ESC: Quit")
            .style(Style::default().add_modifier(Modifier::DIM));

        f.render_widget(help, chunks[3]);
    }

    fn handle_input(
        &mut self,
        key: KeyEvent,
        state: &mut AppState,
        _tx: mpsc::UnboundedSender<AppEvent>,
    ) -> Result<()> {
        let filtered_count = state
            .extensions
            .iter()
            .filter(|ext| {
                self.search_query.is_empty()
                    || ext.name.to_lowercase().contains(&self.search_query.to_lowercase())
                    || ext.id.to_lowercase().contains(&self.search_query.to_lowercase())
                    || ext.tags.iter().any(|t| t.to_lowercase().contains(&self.search_query.to_lowercase()))
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
            KeyCode::Char(c) if !matches!(c, '1'..='5' | 's') => {
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
