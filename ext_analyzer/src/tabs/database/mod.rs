use anyhow::Result;
use ratatui::{crossterm::event::KeyEvent, Frame};
use tokio::sync::mpsc;

use crate::{app::AppState, types::AppEvent};

mod input_handler;
mod renderer;

pub struct ReportsTab {
    selected_index: usize,
    scroll_offset: usize,
    search_query: String,
    search_focused: bool,
    show_tested_only: bool,
    show_untested_only: bool,
}

impl ReportsTab {
    pub fn new() -> Self {
        Self {
            selected_index: 0,
            scroll_offset: 0,
            search_query: String::new(),
            search_focused: false,
            show_tested_only: false,
            show_untested_only: false,
        }
    }
}

impl super::Tab for ReportsTab {
    fn render(
        &mut self,
        f: &mut Frame,
        area: ratatui::layout::Rect,
        state: &AppState,
        _tx: mpsc::UnboundedSender<AppEvent>,
    ) {
        renderer::render(
            f,
            area,
            state,
            self.selected_index,
            &mut self.scroll_offset,
            &self.search_query,
            self.search_focused,
            self.show_tested_only,
            self.show_untested_only,
        );
    }

    fn handle_input(
        &mut self,
        key: KeyEvent,
        state: &mut AppState,
        tx: mpsc::UnboundedSender<AppEvent>,
    ) -> Result<()> {
        input_handler::handle_input(
            key,
            state,
            tx,
            &mut self.selected_index,
            &mut self.scroll_offset,
            &mut self.search_query,
            &mut self.search_focused,
            &mut self.show_tested_only,
            &mut self.show_untested_only,
        )
    }

    fn is_in_text_input_mode(&self) -> bool {
        self.search_focused
    }

    fn as_any_mut(&mut self) -> &mut dyn std::any::Any {
        self
    }
}
