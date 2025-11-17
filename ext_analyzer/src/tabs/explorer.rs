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
    search_query: String,
}

impl ExplorerTab {
    pub fn new() -> Self {
        Self {
            selected_index: 0,
            search_query: String::new(),
        }
    }
}

impl super::Tab for ExplorerTab {
    fn render(&mut self, f: &mut Frame, area: ratatui::layout::Rect, state: &AppState) {
        let chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Length(3),
                Constraint::Length(3),
                Constraint::Min(0),
                Constraint::Length(1),
            ])
            .split(area);

        // Status
        let db_status = if state.db_connected {
            Span::styled("Connected", Style::default().fg(Color::Green))
        } else {
            Span::styled("Disconnected", Style::default().fg(Color::Red))
        };

        let status = Paragraph::new(Line::from(vec![
            Span::raw("Database: "),
            db_status,
            Span::raw(format!(" • Extensions: {}", state.extensions.len())),
        ]))
        .block(Block::default().borders(Borders::NONE));

        f.render_widget(status, chunks[0]);

        // Search bar
        let search_bar = Paragraph::new(Line::from(vec![
            Span::styled("Search: ", Style::default().fg(Color::Gray)),
            Span::raw(&self.search_query),
            Span::styled("█", Style::default().fg(Color::Gray)),
        ]))
        .block(Block::default().borders(Borders::ALL).border_style(Style::default().fg(Color::Cyan)));

        f.render_widget(search_bar, chunks[1]);

        // Extension list
        let filtered_extensions: Vec<_> = state
            .extensions
            .iter()
            .filter(|ext| {
                self.search_query.is_empty()
                    || ext.name.to_lowercase().contains(&self.search_query.to_lowercase())
                    || ext.id.to_lowercase().contains(&self.search_query.to_lowercase())
            })
            .collect();

        let items: Vec<ListItem> = filtered_extensions
            .iter()
            .enumerate()
            .take(15)
            .map(|(idx, ext)| {
                let is_selected = idx == self.selected_index;
                let prefix = if is_selected { "▶ " } else { "  " };
                let name_truncated = if ext.name.len() > 50 {
                    format!("{}...", &ext.name[..50])
                } else {
                    ext.name.clone()
                };

                let score_text = if let Some(score) = ext.interestingness {
                    format!(" (score: {:.1})", score)
                } else {
                    String::new()
                };

                let mv3_indicator = if ext.mv3_extension_id.is_some() {
                    Span::styled(" ✓MV3", Style::default().fg(Color::Green))
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
                    Span::styled(score_text, Style::default().fg(Color::Gray)),
                    mv3_indicator,
                ]))
            })
            .collect();

        let list = List::new(items)
            .block(
                Block::default()
                    .borders(Borders::ALL)
                    .title("Extensions (sorted by interestingness)"),
            );

        f.render_widget(list, chunks[2]);

        // Help text
        let help = Paragraph::new("Use ↑/↓ to navigate • Type to search • R to reload • ENTER to view details")
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
            KeyCode::Char(c) if !matches!(c, '1'..='5') => {
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
