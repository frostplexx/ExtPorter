use ratatui::{
    layout::{Constraint, Direction, Layout},
    style::{Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Paragraph},
    Frame,
};
use tui_textarea::TextArea;

use crate::{
    app::AppState,
    types::{Message, MessageType},
};

use super::dialog;

pub fn render(
    f: &mut Frame,
    area: ratatui::layout::Rect,
    state: &AppState,
    confirmation_dialog: &Option<TextArea<'static>>,
) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Min(0), Constraint::Length(1)])
        .split(area);

    render_messages(f, &chunks[0], state);
    render_footer(f, &chunks[1], state);

    // Render confirmation dialog if active
    if let Some(ref textarea) = confirmation_dialog {
        dialog::render_confirmation_dialog(f, state, textarea);
    }
}

fn render_messages(f: &mut Frame, area: &ratatui::layout::Rect, state: &AppState) {
    // Calculate visible messages based on available space
    let available_lines = area.height as usize;
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
        .map(|msg| format_message(msg, state, f.area().width as usize))
        .collect();

    let messages_widget =
        Paragraph::new(visible_messages).block(Block::default().borders(Borders::NONE));

    f.render_widget(messages_widget, *area);
}

fn format_message(msg: &Message, state: &AppState, max_width: usize) -> Line<'static> {
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
    let content = if msg.content.chars().count() > max_width.saturating_sub(5) {
        let truncate_at = max_width.saturating_sub(8);
        let truncated: String = msg.content.chars().take(truncate_at).collect();
        format!("{} {}...", prefix, truncated)
    } else {
        format!("{} {}", prefix, msg.content)
    };

    Line::from(Span::styled(content, Style::default().fg(color)))
}

fn render_footer(f: &mut Frame, area: &ratatui::layout::Rect, state: &AppState) {
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

    let footer_widget = Paragraph::new(footer).style(Style::default().add_modifier(Modifier::DIM));

    f.render_widget(footer_widget, *area);
}
