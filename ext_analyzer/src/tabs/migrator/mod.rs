use anyhow::Result;
use ratatui::{crossterm::event::KeyEvent, Frame};
use tokio::sync::mpsc;
use tui_textarea::TextArea;

use crate::{app::AppState, types::AppEvent};

mod dialog;
mod input_handler;
mod renderer;

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
        renderer::render(f, area, state, &self.confirmation_dialog);
    }

    fn handle_input(
        &mut self,
        key: KeyEvent,
        state: &mut AppState,
        tx: mpsc::UnboundedSender<AppEvent>,
    ) -> Result<()> {
        input_handler::handle_input(key, state, tx, &mut self.confirmation_dialog)
    }

    fn as_any_mut(&mut self) -> &mut dyn std::any::Any {
        self
    }
}
