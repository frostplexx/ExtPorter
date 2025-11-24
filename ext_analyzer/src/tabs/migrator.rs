use anyhow::Result;
use ratatui::{
    crossterm::event::{KeyCode, KeyEvent},
    layout::{Alignment, Constraint, Direction, Layout},
    style::{Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Clear, Paragraph},
    Frame,
};
use tokio::sync::mpsc;
use tui_textarea::TextArea;

use crate::app::{AppEvent, AppState, Message, MessageType};

pub struct MigratorTab {
    confirmation_dialog: Option<TextArea<'static>>,
}

impl MigratorTab {
    pub fn new() -> Self {
        Self {
            confirmation_dialog: None,
        }
    }
}

impl super::Tab for MigratorTab {
    fn render(
        &mut self,
        f: &mut Frame,
        area: ratatui::layout::Rect,
        state: &AppState,
        _tx: mpsc::UnboundedSender<AppEvent>,
    ) {
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

        // Clamp scroll offset to prevent rendering issues
        let clamped_offset = state.message_scroll_offset.min(total_messages);

        let end_idx = total_messages.saturating_sub(clamped_offset);
        let start_idx = end_idx.saturating_sub(available_lines);

        let visible_messages: Vec<Line> = state
            .messages
            .iter()
            .skip(start_idx)
            .take(end_idx - start_idx)
            .map(|msg| {
                let (prefix, color) = match msg.msg_type {
                    MessageType::Sent => ("[INFO]", state.theme.msg_info),
                    MessageType::Received => ("[INFO]", state.theme.msg_info),
                    MessageType::System => {
                        if msg.content.starts_with('⚠') || msg.content.contains("[ERROR]") {
                            ("", state.theme.msg_error)
                        } else if msg.content.contains("[WARNING]") {
                            ("", state.theme.msg_warning)
                        } else if msg.content.contains("[INFO]") {
                            ("", state.theme.msg_system_info)
                        } else {
                            ("", state.theme.msg_default)
                        }
                    }
                };

                // Unicode-safe truncation: count characters, not bytes
                let max_width = f.area().width as usize;
                let content = if msg.content.chars().count() > max_width.saturating_sub(5) {
                    let truncate_at = max_width.saturating_sub(8);
                    let truncated: String = msg.content.chars().take(truncate_at).collect();
                    format!("{} {}...", prefix, truncated)
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
            Span::styled("● Running", Style::default().fg(state.theme.status_running))
        } else {
            Span::styled("○ Stopped", Style::default().fg(state.theme.status_stopped))
        };

        let scroll_indicator = if state.message_scroll_offset > 0 {
            Span::styled(
                format!(" ↑{}", state.message_scroll_offset),
                Style::default().fg(state.theme.scroll_indicator),
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
            Paragraph::new(footer).style(Style::default().add_modifier(Modifier::DIM));

        f.render_widget(footer_widget, chunks[1]);

        // Render confirmation dialog if active
        if let Some(ref textarea) = self.confirmation_dialog {
            // Create a centered popup with fixed height (3 lines: border + text + border)
            let popup_width = (f.area().width as f32 * 0.1) as u16;
            let popup_height = 3;

            let popup_area = ratatui::layout::Rect {
                x: (f.area().width.saturating_sub(popup_width)) / 2,
                y: (f.area().height.saturating_sub(popup_height)) / 2,
                width: popup_width,
                height: popup_height,
            };

            // Clear the area behind the popup
            f.render_widget(Clear, popup_area);

            // Create outer block with border
            let block = Block::default()
                .borders(Borders::ALL)
                .border_style(Style::default().fg(state.theme.dialog_border))
                .title("Enter 'ExtPorter' to confirm");

            let inner_area = block.inner(popup_area);
            f.render_widget(block, popup_area);

            // Single line with instruction text and input field combined
            let text = format!("{}", textarea.lines().join(""));
            let paragraph =
                Paragraph::new(Line::from(Span::raw(text))).alignment(Alignment::Center);
            f.render_widget(paragraph, inner_area);
        }
    }

    fn handle_input(
        &mut self,
        key: KeyEvent,
        state: &mut AppState,
        tx: mpsc::UnboundedSender<AppEvent>,
    ) -> Result<()> {
        // If confirmation dialog is active, handle its input
        if let Some(ref mut textarea) = self.confirmation_dialog {
            match key.code {
                KeyCode::Esc => {
                    // Cancel confirmation
                    self.confirmation_dialog = None;
                    state.messages.push(Message {
                        msg_type: MessageType::System,
                        content: "[INFO] Migration start cancelled".to_string(),
                        timestamp: chrono::Utc::now(),
                    });
                    state.message_scroll_offset = 0;
                }
                KeyCode::Enter => {
                    // Check if input matches "ExtPorter"
                    let input_text = textarea.lines().join("");
                    if input_text == "ExtPorter" {
                        // Close dialog
                        self.confirmation_dialog = None;

                        // Send start command to server
                        let _ = tx.send(AppEvent::SendWebSocketMessage("start".to_string()));
                        state.messages.push(Message {
                            msg_type: MessageType::System,
                            content: "[INFO] Sending start command to server...".to_string(),
                            timestamp: chrono::Utc::now(),
                        });
                        state.message_scroll_offset = 0;
                    } else {
                        // Wrong input - show error and keep dialog open
                        state.messages.push(Message {
                            msg_type: MessageType::System,
                            content: "[WARNING] Incorrect confirmation text. Please type 'ExtPorter' exactly.".to_string(),
                            timestamp: chrono::Utc::now(),
                        });
                        // Clear the input field
                        *textarea = TextArea::default();
                    }
                }
                _ => {
                    // Pass other keys to the textarea
                    textarea.input(key);
                }
            }
            return Ok(());
        }

        // Normal input handling when dialog is not active
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
                    // Show confirmation dialog
                    self.confirmation_dialog = Some(TextArea::default());
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

    fn as_any_mut(&mut self) -> &mut dyn std::any::Any {
        self
    }

    fn handles_esc(&self) -> bool {
        // Return true if the confirmation dialog is active
        self.confirmation_dialog.is_some()
    }
}
