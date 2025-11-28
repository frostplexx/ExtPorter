use ratatui::{
    layout::{Constraint, Direction, Layout, Rect},
    style::{Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, List, ListItem, Paragraph, Wrap},
    Frame,
};

use crate::app::AppState;
use crate::listener_labels::get_listener_label;

pub fn render(
    f: &mut Frame,
    area: Rect,
    state: &AppState,
    selected_index: usize,
    scroll_offset: &mut usize,
    search_query: &str,
    search_focused: bool,
    show_tested_only: bool,
    show_untested_only: bool,
) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3), // Search bar
            Constraint::Length(1), // Filter status
            Constraint::Min(0),    // Main content
            Constraint::Length(1), // Help text
        ])
        .split(area);

    render_search_bar(f, chunks[0], state, search_query, search_focused);
    render_filter_status(f, chunks[1], state, show_tested_only, show_untested_only);

    // Split main area into list and detail
    let main_chunks = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(40), Constraint::Percentage(60)])
        .split(chunks[2]);

    render_reports_list(
        f,
        main_chunks[0],
        state,
        selected_index,
        scroll_offset,
        search_query,
        show_tested_only,
        show_untested_only,
    );

    render_report_detail(
        f,
        main_chunks[1],
        state,
        selected_index,
        search_query,
        show_tested_only,
        show_untested_only,
    );

    render_help_text(f, chunks[3], search_focused);
}

fn render_search_bar(
    f: &mut Frame,
    area: Rect,
    state: &AppState,
    search_query: &str,
    search_focused: bool,
) {
    let border_style = if search_focused {
        Style::default().fg(state.theme.search_border_active)
    } else {
        Style::default().fg(state.theme.search_border_inactive)
    };

    let search_text = if search_query.is_empty() && !search_focused {
        Span::styled(
            "Press / to search reports...",
            Style::default()
                .fg(state.theme.text_muted)
                .add_modifier(Modifier::DIM),
        )
    } else {
        Span::styled(search_query, Style::default().fg(state.theme.search_label))
    };

    let cursor = if search_focused {
        Span::styled("█", Style::default().fg(state.theme.search_cursor))
    } else {
        Span::raw("")
    };

    let search_box = Paragraph::new(Line::from(vec![search_text, cursor])).block(
        Block::default()
            .borders(Borders::ALL)
            .title("Search Reports")
            .border_style(border_style),
    );

    f.render_widget(search_box, area);
}

fn render_filter_status(
    f: &mut Frame,
    area: Rect,
    state: &AppState,
    show_tested_only: bool,
    show_untested_only: bool,
) {
    let filter_text = if show_tested_only {
        Span::styled(
            "Filter: Tested only",
            Style::default().fg(state.theme.stats_mv3),
        )
    } else if show_untested_only {
        Span::styled(
            "Filter: Untested only",
            Style::default().fg(state.theme.stats_mv2_only),
        )
    } else {
        Span::styled(
            "Filter: All reports",
            Style::default()
                .fg(state.theme.text_muted)
                .add_modifier(Modifier::DIM),
        )
    };

    let status = Paragraph::new(filter_text);
    f.render_widget(status, area);
}

fn render_reports_list(
    f: &mut Frame,
    area: Rect,
    state: &AppState,
    selected_index: usize,
    scroll_offset: &mut usize,
    search_query: &str,
    show_tested_only: bool,
    show_untested_only: bool,
) {
    let filtered_reports =
        get_filtered_reports(state, search_query, show_tested_only, show_untested_only);
    let total_reports = filtered_reports.len();

    // Update scroll offset to keep selected item visible
    let visible_height = area.height.saturating_sub(2) as usize; // -2 for borders
    if selected_index >= *scroll_offset + visible_height {
        *scroll_offset = selected_index.saturating_sub(visible_height - 1);
    } else if selected_index < *scroll_offset {
        *scroll_offset = selected_index;
    }

    let items: Vec<ListItem> = filtered_reports
        .iter()
        .skip(*scroll_offset)
        .take(visible_height)
        .enumerate()
        .map(|(i, report)| {
            let actual_index = i + *scroll_offset;
            let is_selected = actual_index == selected_index;

            // Get extension name
            let ext_name = state
                .extensions
                .iter()
                .find(|e| e.get_id() == report.extension_id)
                .map(|e| e.name.clone())
                .unwrap_or_else(|| report.extension_id.clone());

            // Create status indicator
            let status_indicator = if report.tested {
                Span::styled("✓", Style::default().fg(state.theme.item_mv3_indicator))
            } else {
                Span::styled("○", Style::default().fg(state.theme.text_muted))
            };

            // Create working indicator - prioritize install status, then overall working
            let working_indicator = if let Some(installs) = report.installs {
                if !installs {
                    Span::styled(
                        " ✗ (no install)",
                        Style::default().fg(state.theme.score_low),
                    )
                } else {
                    match report.overall_working.as_deref() {
                        Some("yes") => {
                            Span::styled(" ✓", Style::default().fg(state.theme.score_high))
                        }
                        Some("no") => {
                            Span::styled(" ✗", Style::default().fg(state.theme.score_low))
                        }
                        Some("could_not_test") => {
                            Span::styled(" ?", Style::default().fg(state.theme.text_muted))
                        }
                        _ => Span::raw(""),
                    }
                }
            } else {
                match report.overall_working.as_deref() {
                    Some("yes") => Span::styled(" ✓", Style::default().fg(state.theme.score_high)),
                    Some("no") => Span::styled(" ✗", Style::default().fg(state.theme.score_low)),
                    Some("could_not_test") => {
                        Span::styled(" ?", Style::default().fg(state.theme.text_muted))
                    }
                    _ => Span::raw(""),
                }
            };

            let line = Line::from(vec![
                status_indicator,
                Span::raw(" "),
                Span::raw(ext_name), // Changed from &ext_name to ext_name
                working_indicator,
            ]);

            let style = if is_selected {
                Style::default()
                    .fg(state.theme.item_selected_fg)
                    .bg(state.theme.item_selected_bg)
            } else {
                Style::default()
            };

            ListItem::new(line).style(style)
        })
        .collect();

    let title = format!("Reports ({}/{})", total_reports, state.reports.len());

    let list = List::new(items).block(
        Block::default()
            .borders(Borders::ALL)
            .title(title)
            .border_style(Style::default().fg(state.theme.database_border)),
    );

    f.render_widget(list, area);
}

fn render_report_detail(
    f: &mut Frame,
    area: Rect,
    state: &AppState,
    selected_index: usize,
    search_query: &str,
    show_tested_only: bool,
    show_untested_only: bool,
) {
    let filtered_reports =
        get_filtered_reports(state, search_query, show_tested_only, show_untested_only);

    let detail_text = if let Some(report) = filtered_reports.get(selected_index) {
        let ext = state
            .extensions
            .iter()
            .find(|e| e.get_id() == report.extension_id);

        let mut lines = vec![];

        // Extension name
        if let Some(ext) = ext {
            lines.push(Line::from(vec![
                Span::styled("Extension: ", Style::default().fg(state.theme.detail_label)),
                Span::styled(
                    &ext.name,
                    Style::default().fg(state.theme.analyzer_ext_name),
                ),
            ]));
        }

        lines.push(Line::from(""));

        // Status
        lines.push(Line::from(vec![
            Span::styled("Status: ", Style::default().fg(state.theme.detail_label)),
            if report.tested {
                Span::styled(
                    "Tested",
                    Style::default().fg(state.theme.item_mv3_indicator),
                )
            } else {
                Span::styled("Untested", Style::default().fg(state.theme.text_muted))
            },
        ]));

        // Installs
        if let Some(installs) = report.installs {
            lines.push(Line::from(vec![
                Span::styled("Installs: ", Style::default().fg(state.theme.detail_label)),
                if installs {
                    Span::styled("Yes", Style::default().fg(state.theme.score_high))
                } else {
                    Span::styled("No", Style::default().fg(state.theme.score_low))
                },
            ]));
        }

        // Works in MV2
        if let Some(works_in_mv2) = report.works_in_mv2 {
            lines.push(Line::from(vec![
                Span::styled(
                    "Works in MV2: ",
                    Style::default().fg(state.theme.detail_label),
                ),
                if works_in_mv2 {
                    Span::styled("Yes", Style::default().fg(state.theme.score_high))
                } else {
                    Span::styled("No", Style::default().fg(state.theme.score_low))
                },
            ]));
        }

        // Overall working (tri-state)
        if let Some(ref working_str) = report.overall_working {
            lines.push(Line::from(vec![
                Span::styled(
                    "Overall Working: ",
                    Style::default().fg(state.theme.detail_label),
                ),
                match working_str.as_str() {
                    "yes" => Span::styled("Yes", Style::default().fg(state.theme.score_high)),
                    "no" => Span::styled("No", Style::default().fg(state.theme.score_low)),
                    "could_not_test" => Span::styled( "Could not test", Style::default().fg(state.theme.could_not_test),),
                    _ => Span::styled("Unknown", Style::default().fg(state.theme.could_not_test)),
                },
            ]));
        }

        // Has errors
        if let Some(has_errors) = report.has_errors {
            lines.push(Line::from(vec![
                Span::styled(
                    "Has Errors: ",
                    Style::default().fg(state.theme.detail_label),
                ),
                if has_errors {
                    Span::styled("Yes", Style::default().fg(state.theme.msg_warning))
                } else {
                    Span::styled("No", Style::default().fg(state.theme.score_high))
                },
            ]));
        }

        // Seems slower
        if let Some(seems_slower) = report.seems_slower {
            lines.push(Line::from(vec![
                Span::styled(
                    "Seems Slower: ",
                    Style::default().fg(state.theme.detail_label),
                ),
                Span::raw(if seems_slower { "Yes" } else { "No" }),
            ]));
        }

        // Needs login
        if let Some(needs_login) = report.needs_login {
            lines.push(Line::from(vec![
                Span::styled(
                    "Needs Login: ",
                    Style::default().fg(state.theme.detail_label),
                ),
                Span::raw(if needs_login { "Yes" } else { "No" }),
            ]));
        }

        // Popup broken
        if let Some(is_popup_broken) = report.is_popup_broken {
            lines.push(Line::from(vec![
                Span::styled(
                    "Popup Broken: ",
                    Style::default().fg(state.theme.detail_label),
                ),
                if is_popup_broken {
                    Span::styled("Yes", Style::default().fg(state.theme.score_low))
                } else {
                    Span::styled("No", Style::default().fg(state.theme.score_high))
                },
            ]));
        }

        // Settings broken
        if let Some(is_settings_broken) = report.is_settings_broken {
            lines.push(Line::from(vec![
                Span::styled(
                    "Settings Broken: ",
                    Style::default().fg(state.theme.detail_label),
                ),
                if is_settings_broken {
                    Span::styled("Yes", Style::default().fg(state.theme.score_low))
                } else {
                    Span::styled("No", Style::default().fg(state.theme.score_high))
                },
            ]));
        }

        // Is interesting
        if let Some(is_interesting) = report.is_interesting {
            lines.push(Line::from(vec![
                Span::styled(
                    "Is Interesting: ",
                    Style::default().fg(state.theme.detail_label),
                ),
                Span::raw(if is_interesting { "Yes" } else { "No" }),
            ]));
        }

        // Verification duration
        if let Some(duration) = report.verification_duration_secs {
            lines.push(Line::from(vec![
                Span::styled(
                    "Verification Duration: ",
                    Style::default().fg(state.theme.detail_label),
                ),
                Span::raw(format!("{:.1}s", duration)),
            ]));
        }

        // Listeners
        if !report.listeners.is_empty() {
            lines.push(Line::from(""));
            lines.push(Line::from(Span::styled(
                "Listener Test Results:",
                Style::default()
                    .fg(state.theme.detail_label)
                    .add_modifier(Modifier::BOLD),
            )));

            for listener in &report.listeners {
                let status_color = match listener.status.as_str() {
                    "yes" => state.theme.score_high,
                    "no" => state.theme.score_low,
                    _ => state.theme.text_muted,
                };

                // Use human-readable label instead of API name
                let display_name = get_listener_label(&listener.api);

                lines.push(Line::from(vec![
                    Span::raw("  "),
                    Span::styled(
                        display_name,
                        Style::default().fg(state.theme.analyzer_listener_api),
                    ),
                    Span::raw(" → "),
                    Span::styled(&listener.status, Style::default().fg(status_color)),
                ]));
            }
        }

        // Notes
        if let Some(ref notes) = report.notes {
            if !notes.is_empty() {
                lines.push(Line::from(""));
                lines.push(Line::from(Span::styled(
                    "Notes:",
                    Style::default()
                        .fg(state.theme.detail_label)
                        .add_modifier(Modifier::BOLD),
                )));

                // Wrap notes text
                for note_line in notes.lines() {
                    lines.push(Line::from(note_line));
                }
            }
        }

        // Timestamps
        lines.push(Line::from(""));
        lines.push(Line::from(vec![
            Span::styled("Created: ", Style::default().fg(state.theme.detail_label)),
            Span::raw(format_timestamp(report.created_at)),
        ]));
        lines.push(Line::from(vec![
            Span::styled("Updated: ", Style::default().fg(state.theme.detail_label)),
            Span::raw(format_timestamp(report.updated_at)),
        ]));

        lines
    } else if state.reports.is_empty() {
        vec![
            Line::from(""),
            Line::from(Span::styled(
                "No reports available",
                Style::default()
                    .fg(state.theme.text_muted)
                    .add_modifier(Modifier::DIM),
            )),
            Line::from(""),
            Line::from(Span::styled(
                "Test extensions in the Analyzer tab to create reports",
                Style::default()
                    .fg(state.theme.text_muted)
                    .add_modifier(Modifier::DIM),
            )),
        ]
    } else {
        vec![
            Line::from(""),
            Line::from(Span::styled(
                "No reports match the current filters",
                Style::default()
                    .fg(state.theme.text_muted)
                    .add_modifier(Modifier::DIM),
            )),
        ]
    };

    let detail = Paragraph::new(detail_text)
        .wrap(Wrap { trim: false })
        .block(
            Block::default()
                .borders(Borders::ALL)
                .title("Report Details")
                .border_style(Style::default().fg(state.theme.database_border)),
        );

    f.render_widget(detail, area);
}

fn render_help_text(f: &mut Frame, area: Rect, search_focused: bool) {
    let help_text = if search_focused {
        "ESC: Exit search • Type to filter"
    } else {
        "↑/↓: Navigate • /: Search • T: Tested only • U: Untested only • C: Clear filters • Enter: View in Analyzer"
    };

    let help = Paragraph::new(help_text).style(Style::default().add_modifier(Modifier::DIM));
    f.render_widget(help, area);
}

fn get_filtered_reports<'a>(
    state: &'a AppState,
    search_query: &str,
    show_tested_only: bool,
    show_untested_only: bool,
) -> Vec<&'a crate::types::Report> {
    state
        .reports
        .iter()
        .filter(|report| {
            // Apply tested/untested filter
            if show_tested_only && !report.tested {
                return false;
            }
            if show_untested_only && report.tested {
                return false;
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

fn format_timestamp(timestamp: f64) -> String {
    use chrono::{DateTime, Utc};

    let dt = DateTime::<Utc>::from_timestamp(timestamp as i64, 0).unwrap_or_else(|| Utc::now());

    dt.format("%Y-%m-%d %H:%M:%S").to_string()
}
