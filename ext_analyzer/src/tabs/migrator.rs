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
        let visible_messages: Vec<Line> = state
            .messages
            .iter()
            .rev()
            .take(available_lines)
            .rev()
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
        let help_text = if is_running {
            "[S]top migration"
        } else {
            "[s]tart migration"
        };

        let status_text = if is_running {
            Span::styled("● Running", Style::default().fg(Color::Green))
        } else {
            Span::styled("○ Stopped", Style::default().fg(Color::Red))
        };

        let footer = Line::from(vec![
            Span::raw(help_text),
            Span::raw(" | Status: "),
            status_text,
            Span::styled(
                format!(" ({} msgs)", state.messages.len()),
                Style::default().add_modifier(Modifier::DIM),
            ),
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
            KeyCode::Char('s') => {
                if !state.migration_running {
                    // Send start command to server
                    let _ = tx.send(AppEvent::SendWebSocketMessage("start".to_string()));
                    state.messages.push(Message {
                        msg_type: MessageType::System,
                        content: "[INFO] Sending start command to server...".to_string(),
                        timestamp: chrono::Utc::now(),
                    });
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
