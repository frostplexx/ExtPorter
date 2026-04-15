use ratatui::{
    layout::{Constraint, Direction, Layout},
    style::{Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, List, ListItem, Paragraph},
    Frame,
};

use crate::{app::AppState, types::Extension};

use super::search::{filter_extensions, sort_extensions, SortBy};

pub fn render_list_mode(
    f: &mut Frame,
    area: ratatui::layout::Rect,
    state: &AppState,
    selected_index: usize,
    scroll_offset: &mut usize,
    search_query: &str,
    sort_by: SortBy,
    search_focused: bool,
) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(1),
            Constraint::Length(3),
            Constraint::Min(0),
            Constraint::Length(1),
        ])
        .split(area);

    render_stats_bar(f, &chunks[0], state);
    render_search_bar(f, &chunks[1], state, search_query, sort_by, search_focused);

    let main_chunks = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(50), Constraint::Percentage(50)])
        .split(chunks[2]);

    let mut filtered_extensions = filter_extensions(&state.extensions, search_query);
    sort_extensions(&mut filtered_extensions, sort_by, search_query);

    render_extension_list(
        f,
        &main_chunks[0],
        state,
        &filtered_extensions,
        selected_index,
        scroll_offset,
    );

    render_details_panel(
        f,
        &main_chunks[1],
        state,
        &filtered_extensions,
        selected_index,
    );
    render_help_text(f, &chunks[3], search_focused);
}

fn render_stats_bar(f: &mut Frame, area: &ratatui::layout::Rect, state: &AppState) {
    let mut spans = vec![
        Span::styled("Total:", Style::default().fg(state.theme.stats_total)),
        Span::raw(format!(" {} ", state.extension_stats.total)),
        Span::styled(
            "• Avg Score:",
            Style::default().fg(state.theme.stats_avg_score),
        ),
        Span::raw(format!(" {:.1}", state.extension_stats.avg_score)),
    ];

    if state.loading_extensions {
        spans.push(Span::raw("  "));
        spans.push(Span::styled(
            "Loading...",
            Style::default().fg(state.theme.search_label),
        ));
    }

    let stats = Paragraph::new(Line::from(spans));

    f.render_widget(stats, *area);
}

fn render_search_bar(
    f: &mut Frame,
    area: &ratatui::layout::Rect,
    state: &AppState,
    search_query: &str,
    sort_by: SortBy,
    search_focused: bool,
) {
    let cursor = if search_focused {
        Span::styled("█", Style::default().fg(state.theme.search_cursor))
    } else {
        Span::raw(" ")
    };

    let border_style = if search_focused {
        Style::default()
            .fg(state.theme.search_border_active)
            .add_modifier(Modifier::BOLD)
    } else {
        Style::default().fg(state.theme.search_border_inactive)
    };

    let search_bar = Paragraph::new(Line::from(vec![
        Span::styled("Search: ", Style::default().fg(state.theme.search_label)),
        Span::raw(search_query),
        cursor,
        Span::styled(
            " • Sort by: ",
            Style::default().fg(state.theme.search_label),
        ),
        Span::styled(
            sort_by.as_str(),
            Style::default().fg(state.theme.stats_total),
        ),
    ]))
    .block(
        Block::default()
            .borders(Borders::ALL)
            .border_style(border_style),
    );

    f.render_widget(search_bar, *area);
}

fn render_extension_list(
    f: &mut Frame,
    area: &ratatui::layout::Rect,
    state: &AppState,
    filtered_extensions: &[&Extension],
    selected_index: usize,
    scroll_offset: &mut usize,
) {
    let filtered_count = filtered_extensions.len();
    let list_height = area.height.saturating_sub(2) as usize;

    // Adjust scroll offset to keep selected item visible
    if selected_index >= *scroll_offset + list_height {
        *scroll_offset = selected_index.saturating_sub(list_height - 1);
    }
    if selected_index < *scroll_offset {
        *scroll_offset = selected_index;
    }

    let visible_start = *scroll_offset;
    let visible_end = (*scroll_offset + list_height).min(filtered_count);

    let items: Vec<ListItem> = filtered_extensions
        .iter()
        .enumerate()
        .skip(visible_start)
        .take(visible_end - visible_start)
        .map(|(idx, ext)| {
            let is_selected = idx == selected_index;
            let prefix = if is_selected { "▶ " } else { "  " };
            let name_truncated = if ext.name.chars().count() > 30 {
                let truncated: String = ext.name.chars().take(30).collect();
                format!("{}...", truncated)
            } else {
                ext.name.clone()
            };

            // Check if extension has been tested
            let is_tested = state
                .reports
                .iter()
                .any(|r| r.extension_id == ext.get_id() && r.tested);

            let tested_indicator = if is_tested {
                Span::styled(" ✓", Style::default().fg(state.theme.stats_avg_score))
            } else {
                Span::raw("")
            };

            let style = if is_selected {
                Style::default()
                    .fg(state.theme.item_selected_fg)
                    .add_modifier(Modifier::BOLD)
                    .bg(state.theme.item_selected_bg)
            } else {
                Style::default()
            };

            ListItem::new(Line::from(vec![
                Span::styled(format!("{}{}", prefix, name_truncated), style),
                tested_indicator,
            ]))
        })
        .collect();

    let list_title = if filtered_count > list_height {
        format!(
            "Extensions ({}-{} of {})",
            visible_start + 1,
            visible_end,
            filtered_count
        )
    } else {
        format!("Extensions ({})", filtered_count)
    };

    let list = List::new(items).block(Block::default().borders(Borders::ALL).title(list_title));
    f.render_widget(list, *area);
}

fn render_details_panel(
    f: &mut Frame,
    area: &ratatui::layout::Rect,
    state: &AppState,
    filtered_extensions: &[&Extension],
    selected_index: usize,
) {
    let selected_ext = filtered_extensions.get(selected_index);
    let details_text = if let Some(ext) = selected_ext {
        let mut lines = vec![
            Line::from(vec![
                Span::styled(
                    "Name: ",
                    Style::default()
                        .fg(state.theme.detail_label)
                        .add_modifier(Modifier::BOLD),
                ),
                Span::raw(&ext.name),
            ]),
            Line::from(vec![
                Span::styled(
                    "ID: ",
                    Style::default()
                        .fg(state.theme.detail_label)
                        .add_modifier(Modifier::BOLD),
                ),
                Span::raw(ext.get_id()),
            ]),
            Line::from(vec![
                Span::styled(
                    "Version: ",
                    Style::default()
                        .fg(state.theme.detail_label)
                        .add_modifier(Modifier::BOLD),
                ),
                Span::raw(ext.version.as_deref().unwrap_or("N/A")),
            ]),
            Line::from(vec![
                Span::styled(
                    "MV3 ID: ",
                    Style::default()
                        .fg(state.theme.detail_label)
                        .add_modifier(Modifier::BOLD),
                ),
                Span::raw(ext.mv3_extension_id.as_deref().unwrap_or("N/A")),
            ]),
            Line::from(vec![
                Span::styled(
                    "Interestingness: ",
                    Style::default()
                        .fg(state.theme.detail_label)
                        .add_modifier(Modifier::BOLD),
                ),
                if let Some(score) = ext.interestingness {
                    let color = if score > 80.0 {
                        state.theme.score_high
                    } else if score > 50.0 {
                        state.theme.score_medium
                    } else {
                        state.theme.score_low
                    };
                    Span::styled(format!("{:.1}", score), Style::default().fg(color))
                } else {
                    Span::raw("N/A")
                },
            ]),
            Line::from(""),
            Line::from(vec![Span::styled(
                "Tags: ",
                Style::default()
                    .fg(state.theme.detail_label)
                    .add_modifier(Modifier::BOLD),
            )]),
            Line::from(if ext.tags.is_empty() {
                Span::styled("No tags", Style::default().fg(state.theme.text_muted))
            } else {
                Span::raw(ext.tags.join(", "))
            }),
        ];

        // Add analyzer status indicator
        if let Some(ref selected_id) = state.selected_extension_id {
            if selected_id == &ext.get_id() {
                lines.push(Line::from(""));
                lines.push(Line::from(vec![
                    Span::styled(
                        "⚡ ",
                        Style::default().fg(state.theme.analyzer_loaded_indicator),
                    ),
                    Span::styled(
                        "Loaded in Analyzer",
                        Style::default()
                            .fg(state.theme.analyzer_loaded_indicator)
                            .add_modifier(Modifier::BOLD),
                    ),
                ]));
            }
        }

        lines
    } else {
        vec![Line::from(Span::styled(
            "Select an extension to view details",
            Style::default()
                .fg(state.theme.text_muted)
                .add_modifier(Modifier::DIM),
        ))]
    };

    let details =
        Paragraph::new(details_text).block(Block::default().borders(Borders::ALL).title("Details"));
    f.render_widget(details, *area);
}

fn render_help_text(f: &mut Frame, area: &ratatui::layout::Rect, search_focused: bool) {
    let help_text = if search_focused {
        "Type to search • Backspace: Delete • Enter/Esc: Exit search"
    } else {
        "↑/↓/PgUp/PgDn/Home/End: Navigate • /: Search • S: Sort • C: Clear • R: Refresh • A: Send to Analyzer"
    };

    let help = Paragraph::new(help_text).style(Style::default().add_modifier(Modifier::DIM));
    f.render_widget(help, *area);
}
