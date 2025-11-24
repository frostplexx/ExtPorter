use ratatui::{
    layout::Alignment,
    style::Style,
    text::{Line, Span},
    widgets::{Block, Borders, Clear, Paragraph},
    Frame,
};
use tui_textarea::TextArea;

use crate::app::AppState;

pub fn render_confirmation_dialog(f: &mut Frame, state: &AppState, textarea: &TextArea<'static>) {
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
    let paragraph = Paragraph::new(Line::from(Span::raw(text))).alignment(Alignment::Center);
    f.render_widget(paragraph, inner_area);
}
