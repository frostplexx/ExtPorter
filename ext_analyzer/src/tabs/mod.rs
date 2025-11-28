use anyhow::Result;
use ratatui::{crossterm::event::KeyEvent, Frame};
use tokio::sync::mpsc;

use crate::{app::AppState, types::AppEvent};

pub mod analyzer;
pub mod database;
pub mod explorer;
pub mod migrator;

pub use database::ReportsTab;

pub trait Tab: Send {
    fn render(
        &mut self,
        f: &mut Frame,
        area: ratatui::layout::Rect,
        state: &AppState,
        tx: mpsc::UnboundedSender<AppEvent>,
    );
    fn handle_input(
        &mut self,
        key: KeyEvent,
        state: &mut AppState,
        tx: mpsc::UnboundedSender<AppEvent>,
    ) -> Result<()>;

    /// Returns true if the tab is currently in text input mode
    /// (e.g., typing in a search box or text field)
    fn is_in_text_input_mode(&self) -> bool {
        false // Default: not in text input mode
    }

    /// Allows downcasting to concrete tab types
    #[allow(dead_code)]
    fn as_any_mut(&mut self) -> &mut dyn std::any::Any;
}
