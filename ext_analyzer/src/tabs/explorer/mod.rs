use anyhow::Result;
use ratatui::{crossterm::event::KeyEvent, Frame};
use tokio::sync::mpsc;

use crate::{app::AppState, types::AppEvent};

mod input_handler;
mod renderer;
mod search;

pub use search::SortBy;

pub struct ExplorerTab {
    selected_index: usize,
    scroll_offset: usize,
    search_query: String,
    sort_by: SortBy,
    search_focused: bool,
}

impl ExplorerTab {
    pub fn new() -> Self {
        Self {
            selected_index: 0,
            scroll_offset: 0,
            search_query: String::new(),
            sort_by: SortBy::Interestingness,
            search_focused: false,
        }
    }
}

impl super::Tab for ExplorerTab {
    fn render(
        &mut self,
        f: &mut Frame,
        area: ratatui::layout::Rect,
        state: &AppState,
        _tx: mpsc::UnboundedSender<AppEvent>,
    ) {
        renderer::render_list_mode(
            f,
            area,
            state,
            self.selected_index,
            &mut self.scroll_offset,
            &self.search_query,
            self.sort_by,
            self.search_focused,
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
            &mut self.sort_by,
            &mut self.search_focused,
        )
    }

    fn as_any_mut(&mut self) -> &mut dyn std::any::Any {
        self
    }
}
