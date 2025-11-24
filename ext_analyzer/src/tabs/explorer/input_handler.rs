use anyhow::Result;
use ratatui::crossterm::event::{KeyCode, KeyEvent};
use tokio::sync::mpsc;

use crate::{app::AppState, types::AppEvent};

use super::search::{filter_extensions, SortBy};

pub fn handle_input(
    key: KeyEvent,
    state: &mut AppState,
    tx: mpsc::UnboundedSender<AppEvent>,
    selected_index: &mut usize,
    scroll_offset: &mut usize,
    search_query: &mut String,
    sort_by: &mut SortBy,
    search_focused: &mut bool,
) -> Result<()> {
    let filtered_count = filter_extensions(&state.extensions, search_query).len();

    // Handle search field focus/unfocus
    match key.code {
        KeyCode::Char('/') if !*search_focused => {
            *search_focused = true;
            return Ok(());
        }
        KeyCode::Esc if *search_focused => {
            *search_focused = false;
            return Ok(());
        }
        KeyCode::Enter if *search_focused => {
            *search_focused = false;
            return Ok(());
        }
        _ => {}
    }

    // If search is focused, only handle text input and backspace
    if *search_focused {
        match key.code {
            KeyCode::Char(c) => {
                search_query.push(c);
                *selected_index = 0;
                *scroll_offset = 0;
            }
            KeyCode::Backspace => {
                search_query.pop();
                *selected_index = 0;
                *scroll_offset = 0;
            }
            _ => {}
        }
        return Ok(());
    }

    // Normal mode shortcuts (only active when search is NOT focused)
    match key.code {
        KeyCode::Up => {
            if *selected_index > 0 {
                *selected_index -= 1;
                if *selected_index < *scroll_offset {
                    *scroll_offset = *selected_index;
                }
            }
        }
        KeyCode::Down => {
            if *selected_index < filtered_count.saturating_sub(1) {
                *selected_index += 1;
            }
        }
        KeyCode::PageUp => {
            *selected_index = selected_index.saturating_sub(20);
            *scroll_offset = scroll_offset.saturating_sub(20);
        }
        KeyCode::PageDown => {
            *selected_index = (*selected_index + 20).min(filtered_count.saturating_sub(1));
        }
        KeyCode::Home => {
            *selected_index = 0;
            *scroll_offset = 0;
        }
        KeyCode::End => {
            *selected_index = filtered_count.saturating_sub(1);
        }
        KeyCode::Char('s') | KeyCode::Char('S') => {
            *sort_by = sort_by.next();
        }
        KeyCode::Char('r') | KeyCode::Char('R') => {
            let extensions_request = r#"{"type":"db_query","id":"get_extensions","method":"getExtensionsWithStats","params":{}}"#;
            let _ = tx.send(AppEvent::SendWebSocketMessage(
                extensions_request.to_string(),
            ));
        }
        KeyCode::Char('c') | KeyCode::Char('C') => {
            search_query.clear();
            *selected_index = 0;
            *scroll_offset = 0;
        }
        KeyCode::Char('a') | KeyCode::Char('A') => {
            let filtered_extensions = filter_extensions(&state.extensions, search_query);
            if let Some(ext) = filtered_extensions.get(*selected_index) {
                state.selected_extension_id = Some(ext.get_id());
                let _ = tx.send(AppEvent::SwitchToTab(2));
            }
        }
        _ => {}
    }
    Ok(())
}
