use anyhow::Result;
use ratatui::crossterm::event::{KeyCode, KeyEvent};
use tokio::sync::mpsc;

use crate::{app::AppState, types::AppEvent};
use chrono::Utc;

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

    // Helper to build params including optional seed
    let build_params = |page: usize,
                        page_size: usize,
                        search: &str,
                        sort: &SortBy,
                        state: &mut AppState| {
        // Ensure seed exists when using Random
        if sort.to_param() == "random" && state.current_random_seed.is_none() {
            state.current_random_seed = Some(format!("{}", Utc::now().timestamp_nanos()));
        }
        if sort.to_param() != "random" {
            state.current_random_seed = None;
        }

        let mut params = serde_json::json!({ "page": page, "pageSize": page_size, "search": search, "sort": sort.to_param() });
        if let Some(ref s) = state.current_random_seed {
            params["seed"] = serde_json::json!(s);
        }
        params
    };

    // If search is focused, only handle text input and backspace
    if *search_focused {
        match key.code {
            KeyCode::Char(c) => {
                search_query.push(c);
                *selected_index = 0;
                *scroll_offset = 0;

                // Update global search/sort state
                state.current_search = search_query.clone();
                state.current_sort = *sort_by;

                let params = build_params(0, 100, search_query, sort_by, state);
                let query = serde_json::json!({
                    "type": "db_query",
                    "id": "get_extensions",
                    "method": "getExtensionsWithStats",
                    "params": params
                });

                state.loading_extensions = true;
                let _ = tx.send(crate::types::AppEvent::SendWebSocketMessage(
                    query.to_string(),
                ));
            }
            KeyCode::Backspace => {
                search_query.pop();
                *selected_index = 0;
                *scroll_offset = 0;

                // Update global search/sort state
                state.current_search = search_query.clone();
                state.current_sort = *sort_by;

                let params = build_params(0, 100, search_query, sort_by, state);
                let query = serde_json::json!({
                    "type": "db_query",
                    "id": "get_extensions",
                    "method": "getExtensionsWithStats",
                    "params": params
                });

                state.loading_extensions = true;
                let _ = tx.send(crate::types::AppEvent::SendWebSocketMessage(
                    query.to_string(),
                ));
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

                // If we're near the end of loaded extensions, request the next page from server
                let current_loaded = state.extensions.len();
                if *selected_index + 5 >= current_loaded {
                    // Request next page only if more pages may exist
                    let next_page = (current_loaded / 100) as usize; // pageSize is 100
                    let params = build_params(next_page, 100, search_query, sort_by, state);
                    let query = serde_json::json!({
                        "type": "db_query",
                        "id": "get_extensions",
                        "method": "getExtensionsWithStats",
                        "params": params
                    });
                    // Show loading indicator
                    state.loading_extensions = true;
                    let _ = tx.send(crate::types::AppEvent::SendWebSocketMessage(
                        query.to_string(),
                    ));
                }
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
            // Update global state and request fresh page 0 with new sort
            state.current_search = search_query.clone();
            state.current_sort = *sort_by;

            // If switched to Random, build_params will create a seed; otherwise it clears it
            let params = build_params(0, 100, search_query, sort_by, state);
            let query = serde_json::json!({
                "type": "db_query",
                "id": "get_extensions",
                "method": "getExtensionsWithStats",
                "params": params
            });
            state.loading_extensions = true;
            let _ = tx.send(crate::types::AppEvent::SendWebSocketMessage(
                query.to_string(),
            ));
        }
        KeyCode::Char('r') | KeyCode::Char('R') => {
            // Refresh (keep seed if random)
            let params = build_params(0, 100, search_query, sort_by, state);
            let query = serde_json::json!({
                "type": "db_query",
                "id": "get_extensions",
                "method": "getExtensionsWithStats",
                "params": params
            });
            // Show loading indicator
            state.loading_extensions = true;
            let _ = tx.send(crate::types::AppEvent::SendWebSocketMessage(
                query.to_string(),
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
