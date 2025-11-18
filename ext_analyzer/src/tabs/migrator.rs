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

use crate::app::{AppEvent, AppState, Message, MessageType};

pub struct MigratorTab;

impl MigratorTab {
    pub fn new() -> Self {
        Self
    }
}

impl super::Tab for MigratorTab {
    fn render(&mut self, f: &mut Frame, area: ratatui::layout::Rect, state: &AppState) {
        let chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints([Constraint::Min(0), Constraint::Length(1)])
            .split(area);

        // Calculate visible messages based on available space
        let available_lines = chunks[0].height as usize;
        let total_messages = state.messages.len();

        // Determine the range of messages to display based on scroll offset
        // scroll_offset = 0 means we're at the bottom (showing most recent)
        // scroll_offset > 0 means we're scrolled up

        let end_idx = total_messages.saturating_sub(state.message_scroll_offset);
        let start_idx = end_idx.saturating_sub(available_lines);

        // Clamp to ensure we always show exactly available_lines (or fewer if not enough messages)
        let actual_end = end_idx.min(total_messages);
        let actual_start = start_idx.min(actual_end);

        let visible_messages: Vec<Line> = state
            .messages
            .iter()
            .skip(actual_start)
            .take(actual_end - actual_start)
            .map(|msg| {
                let (prefix, color) = match msg.msg_type {
                    MessageType::Sent => ("[INFO]", Color::Magenta),
                    MessageType::Received => ("[INFO]", Color::Magenta),
                    MessageType::System => {
                        if msg.content.starts_with('⚠') || msg.content.contains("[ERROR]") {
                            ("", Color::Red)
                        } else if msg.content.contains("[WARNING]") {
                            ("", Color::Yellow)
                        } else if msg.content.contains("[INFO]") {
                            ("", Color::Cyan)
                        } else {
                            ("", Color::White)
                        }
                    }
                };

                let content = if msg.content.len() > (f.area().width as usize - 5) {
                    format!(
                        "{} {}...",
                        prefix,
                        &msg.content[..f.area().width as usize - 8]
                    )
                } else {
                    format!("{} {}", prefix, msg.content)
                };

                Line::from(Span::styled(content, Style::default().fg(color)))
            })
            .collect();

        let messages_widget =
            Paragraph::new(visible_messages).block(Block::default().borders(Borders::NONE));

        f.render_widget(messages_widget, chunks[0]);

        // Footer
        let is_running = state.migration_running;
        let base_help = if is_running {
            "[S]top migration"
        } else {
            "[s]tart migration"
        };

        let help_text = if state.message_scroll_offset > 0 {
            format!("{} | [↑/↓] scroll | [b]ottom", base_help)
        } else {
            format!("{} | [↑/↓] scroll", base_help)
        };

        let status_text = if is_running {
            Span::styled("● Running", Style::default().fg(Color::Green))
        } else {
            Span::styled("○ Stopped", Style::default().fg(Color::Red))
        };

        let scroll_indicator = if state.message_scroll_offset > 0 {
            Span::styled(
                format!(" ↑{}", state.message_scroll_offset),
                Style::default().fg(Color::Yellow),
            )
        } else {
            Span::raw("")
        };

        let footer = Line::from(vec![
            Span::raw(help_text),
            Span::raw(" | Status: "),
            status_text,
            Span::styled(
                format!(" ({} msgs)", state.messages.len()),
                Style::default().add_modifier(Modifier::DIM),
            ),
            scroll_indicator,
        ]);

        let footer_widget =
            Paragraph::new(footer).style(Style::default().bg(Color::Rgb(88, 70, 120)));

        f.render_widget(footer_widget, chunks[1]);
    }

    fn handle_input(
        &mut self,
        key: KeyEvent,
        state: &mut AppState,
        tx: mpsc::UnboundedSender<AppEvent>,
    ) -> Result<()> {
        match key.code {
            KeyCode::Up => {
                // Scroll up (view older messages)
                let max_scroll = state.messages.len().saturating_sub(1);
                if state.message_scroll_offset < max_scroll {
                    state.message_scroll_offset += 1;
                }
            }
            KeyCode::Down => {
                // Scroll down (view newer messages)
                if state.message_scroll_offset > 0 {
                    state.message_scroll_offset -= 1;
                }
            }
            KeyCode::PageUp => {
                // Scroll up by 10 messages
                let max_scroll = state.messages.len().saturating_sub(1);
                state.message_scroll_offset = (state.message_scroll_offset + 10).min(max_scroll);
            }
            KeyCode::PageDown => {
                // Scroll down by 10 messages
                state.message_scroll_offset = state.message_scroll_offset.saturating_sub(10);
            }
            KeyCode::Home => {
                // Jump to oldest messages
                state.message_scroll_offset = state.messages.len().saturating_sub(1);
            }
            KeyCode::End => {
                // Jump to newest messages (bottom)
                state.message_scroll_offset = 0;
            }
            KeyCode::Char('b') | KeyCode::Char('B') => {
                // Jump to bottom (newest messages)
                state.message_scroll_offset = 0;
            }
            KeyCode::Char('s') => {
                if !state.migration_running {
                    // Send start command to server
                    let _ = tx.send(AppEvent::SendWebSocketMessage("start".to_string()));
                    state.messages.push(Message {
                        msg_type: MessageType::System,
                        content: "[INFO] Sending start command to server...".to_string(),
                        timestamp: chrono::Utc::now(),
                    });
                    // Auto-scroll to bottom when new message arrives
                    state.message_scroll_offset = 0;
                } else {
                    state.messages.push(Message {
                        msg_type: MessageType::System,
                        content: "[WARNING] Migration is already running".to_string(),
                        timestamp: chrono::Utc::now(),
                    });
                }
            }
            KeyCode::Char('S') => {
                if state.migration_running {
                    // Send stop command to server
                    let _ = tx.send(AppEvent::SendWebSocketMessage("stop".to_string()));
                    state.messages.push(Message {
                        msg_type: MessageType::System,
                        content: "[INFO] Sending stop command to server...".to_string(),
                        timestamp: chrono::Utc::now(),
                    });
                    // Auto-scroll to bottom when new message arrives
                    state.message_scroll_offset = 0;
                } else {
                    state.messages.push(Message {
                        msg_type: MessageType::System,
                        content: "[WARNING] No migration is running".to_string(),
                        timestamp: chrono::Utc::now(),
                    });
                }
            }
            _ => {}
        }
        Ok(())
    }
}
