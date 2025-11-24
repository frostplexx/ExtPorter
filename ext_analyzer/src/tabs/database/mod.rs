use anyhow::Result;
use ratatui::{crossterm::event::KeyEvent, Frame};
use tokio::sync::mpsc;

use crate::{app::AppState, types::AppEvent};

mod input_handler;
mod renderer;

#[derive(Clone, Copy)]
pub enum ViewMode {
    Collections,
    Query,
}

pub struct DatabaseTab {
    view_mode: ViewMode,
}

impl DatabaseTab {
    pub fn new() -> Self {
        Self {
            view_mode: ViewMode::Collections,
        }
    }
}

impl super::Tab for DatabaseTab {
    fn render(
        &mut self,
        f: &mut Frame,
        area: ratatui::layout::Rect,
        state: &AppState,
        _tx: mpsc::UnboundedSender<AppEvent>,
    ) {
        renderer::render(f, area, state, self.view_mode);
    }

    fn handle_input(
        &mut self,
        key: KeyEvent,
        state: &mut AppState,
        tx: mpsc::UnboundedSender<AppEvent>,
    ) -> Result<()> {
        input_handler::handle_input(key, state, tx, &mut self.view_mode)
    }

    fn as_any_mut(&mut self) -> &mut dyn std::any::Any {
        self
    }
}
