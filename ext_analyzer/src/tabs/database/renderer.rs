use ratatui::{
    layout::{Constraint, Direction, Layout},
    style::{Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Paragraph},
    Frame,
};

use crate::app::AppState;

use super::ViewMode;

pub fn render(f: &mut Frame, area: ratatui::layout::Rect, state: &AppState, view_mode: ViewMode) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(1),
            Constraint::Min(0),
            Constraint::Length(1),
        ])
        .split(area);

    render_status_bar(f, &chunks[0], state, view_mode);

    let main_chunks = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(30), Constraint::Percentage(70)])
        .split(chunks[1]);

    render_collections_panel(f, &main_chunks[0], state);
    render_query_panel(f, &main_chunks[1], state);
    render_help_text(f, &chunks[2], view_mode);
}

fn render_status_bar(
    f: &mut Frame,
    area: &ratatui::layout::Rect,
    state: &AppState,
    view_mode: ViewMode,
) {
    let db_status = if state.db_connected {
        Span::styled(
            "connected",
            Style::default().fg(state.theme.database_connected),
        )
    } else {
        Span::styled(
            "disconnected",
            Style::default().fg(state.theme.database_disconnected),
        )
    };

    let mode_text = match view_mode {
        ViewMode::Collections => "Browse",
        ViewMode::Query => "Query",
    };

    let status = Paragraph::new(Line::from(vec![
        Span::styled("Database:", Style::default().fg(state.theme.database_label)),
        Span::raw(" "),
        db_status,
        Span::raw(" • "),
        Span::styled("Mode:", Style::default().fg(state.theme.database_label)),
        Span::raw(" "),
        Span::styled(mode_text, Style::default().fg(state.theme.database_mode)),
    ]));

    f.render_widget(status, *area);
}

fn render_collections_panel(f: &mut Frame, area: &ratatui::layout::Rect, state: &AppState) {
    let collections_text = vec![
        Line::from("extensions (mock data)"),
        Line::from("logs (mock data)"),
    ];

    let collections = Paragraph::new(collections_text).block(
        Block::default()
            .borders(Borders::ALL)
            .title("Collections")
            .border_style(Style::default().fg(state.theme.database_border)),
    );

    f.render_widget(collections, *area);
}

fn render_query_panel(f: &mut Frame, area: &ratatui::layout::Rect, state: &AppState) {
    let query_text = vec![
        Line::from(vec![
            Span::styled(
                "Query: ",
                Style::default().fg(state.theme.database_query_label),
            ),
            Span::styled("{}", Style::default().fg(state.theme.database_query_text)),
        ]),
        Line::from(""),
        Line::from(Span::styled(
            "Database querying functionality is available in TypeScript version.",
            Style::default().fg(state.theme.database_info_message),
        )),
        Line::from(""),
        Line::from(Span::styled(
            "This Rust client provides a streamlined interface focused on",
            Style::default()
                .fg(state.theme.database_info_dim)
                .add_modifier(Modifier::DIM),
        )),
        Line::from(Span::styled(
            "core migration monitoring and extension browsing.",
            Style::default()
                .fg(state.theme.database_info_dim)
                .add_modifier(Modifier::DIM),
        )),
    ];

    let query_panel = Paragraph::new(query_text).block(
        Block::default()
            .borders(Borders::ALL)
            .title("Query & Results")
            .border_style(Style::default().fg(state.theme.database_border)),
    );

    f.render_widget(query_panel, *area);
}

fn render_help_text(f: &mut Frame, area: &ratatui::layout::Rect, view_mode: ViewMode) {
    let help_text = match view_mode {
        ViewMode::Collections => {
            "M: Toggle mode • Database features available in TypeScript version"
        }
        ViewMode::Query => "M: Toggle mode • ESC: Back",
    };

    let help = Paragraph::new(help_text).style(Style::default().add_modifier(Modifier::DIM));
    f.render_widget(help, *area);
}
