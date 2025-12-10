use anyhow::Result;
use ratatui::crossterm::event::{KeyCode, KeyEvent};
use tokio::sync::mpsc;
use tui_textarea::TextArea;

use crate::{
    app::AppState,
    types::{AppEvent, Message, MessageType},
};

pub fn handle_input(
    key: KeyEvent,
    state: &mut AppState,
    tx: mpsc::UnboundedSender<AppEvent>,
    confirmation_dialog: &mut Option<TextArea<'static>>,
) -> Result<()> {
    // If confirmation dialog is active, handle its input
    if confirmation_dialog.is_some() {
        handle_dialog_input(key, state, tx, confirmation_dialog)?;
        return Ok(());
    }

    // Normal input handling when dialog is not active
    handle_normal_input(key, state, tx, confirmation_dialog)?;
    Ok(())
}

fn handle_dialog_input(
    key: KeyEvent,
    state: &mut AppState,
    tx: mpsc::UnboundedSender<AppEvent>,
    confirmation_dialog: &mut Option<TextArea<'static>>,
) -> Result<()> {
    match key.code {
        KeyCode::Esc => {
            // Cancel confirmation
            *confirmation_dialog = None;
            state.messages.push(Message {
                msg_type: MessageType::System,
                content: "[INFO] Migration start cancelled".to_string(),
                timestamp: chrono::Utc::now(),
            });
            state.message_scroll_offset = 0;
        }
        KeyCode::Enter => {
            // Check if input matches "ExtPorter"
            let textarea = confirmation_dialog.as_ref().unwrap();
            let input_text = textarea.lines().join("");
            if input_text == "ExtPorter" {
                // Close dialog
                *confirmation_dialog = None;

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
                    content:
                        "[WARNING] Incorrect confirmation text. Please type 'ExtPorter' exactly."
                            .to_string(),
                    timestamp: chrono::Utc::now(),
                });
                // Clear the input field
                *confirmation_dialog = Some(TextArea::default());
            }
        }
        _ => {
            // Pass other keys to the textarea
            if let Some(ref mut textarea) = confirmation_dialog {
                textarea.input(key);
            }
        }
    }
    Ok(())
}

fn handle_normal_input(
    key: KeyEvent,
    state: &mut AppState,
    tx: mpsc::UnboundedSender<AppEvent>,
    confirmation_dialog: &mut Option<TextArea<'static>>,
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
                // Show confirmation dialog
                *confirmation_dialog = Some(TextArea::default());
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
