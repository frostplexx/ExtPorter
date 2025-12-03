use anyhow::Result;
use ratatui::crossterm::event::{KeyCode, KeyEvent};
use tokio::sync::mpsc;

use crate::{app::AppState, types::AppEvent};

pub fn handle_input(
    key: KeyEvent,
    state: &mut AppState,
    tx: mpsc::UnboundedSender<AppEvent>,
    selected_index: &mut usize,
    scroll_offset: &mut usize,
    search_query: &mut String,
    search_focused: &mut bool,
    show_interesting_only: &mut bool,
) -> Result<()> {
    // Handle search input mode
    if *search_focused {
        match key.code {
            KeyCode::Esc => {
                *search_focused = false;
            }
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

    // Get filtered reports
    let filtered_reports = get_filtered_reports(state, search_query, *show_interesting_only);
    let total_reports = filtered_reports.len();

    // Handle normal navigation
    match key.code {
        KeyCode::Char('/') => {
            *search_focused = true;
        }
        KeyCode::Char('i') => {
            // Toggle show interesting only
            *show_interesting_only = !*show_interesting_only;
            *selected_index = 0;
            *scroll_offset = 0;
        }
        KeyCode::Char('c') => {
            // Clear all filters
            *show_interesting_only = false;
            search_query.clear();
            *selected_index = 0;
            *scroll_offset = 0;
        }
        KeyCode::Up | KeyCode::Char('k') => {
            if *selected_index > 0 {
                *selected_index -= 1;
            }
        }
        KeyCode::Down | KeyCode::Char('j') => {
            if total_reports > 0 && *selected_index < total_reports - 1 {
                *selected_index += 1;
            }
        }
        KeyCode::Enter => {
            // Load the selected extension in the Analyzer tab
            if let Some(report) = filtered_reports.get(*selected_index) {
                state.selected_extension_id = Some(report.extension_id.clone());
                let _ = tx.send(AppEvent::SwitchToTab(2)); // Switch to Analyzer tab
            }
        }
        _ => {}
    }

    Ok(())
}

fn get_filtered_reports<'a>(
    state: &'a AppState,
    search_query: &str,
    show_interesting_only: bool,
) -> Vec<&'a crate::types::Report> {
    state
        .reports
        .iter()
        .filter(|report| {
            // Apply interesting filter
            if show_interesting_only {
                if let Some(is_interesting) = report.is_interesting {
                    if !is_interesting {
                        return false;
                    }
                } else {
                    // If is_interesting is None, exclude when filtering
                    return false;
                }
            }

            // Apply search query
            if !search_query.is_empty() {
                let query_lower = search_query.to_lowercase();

                // Search in extension name
                if let Some(ext) = state
                    .extensions
                    .iter()
                    .find(|e| e.get_id() == report.extension_id)
                {
                    if ext.name.to_lowercase().contains(&query_lower) {
                        return true;
                    }
                }

                // Search in notes
                if let Some(ref notes) = report.notes {
                    if notes.to_lowercase().contains(&query_lower) {
                        return true;
                    }
                }

                // Search in extension ID
                if report.extension_id.to_lowercase().contains(&query_lower) {
                    return true;
                }

                return false;
            }

            true
        })
        .collect()
}
