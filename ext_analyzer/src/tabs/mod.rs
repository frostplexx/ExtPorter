use anyhow::Result;
use crossterm::event::KeyEvent;
use ratatui::Frame;
use tokio::sync::mpsc;

use crate::app::{AppEvent, AppState};

pub mod analyzer;
pub mod database;
pub mod explorer;
pub mod image_handler;
pub mod migrator;

pub trait Tab: Send {
    fn render(&mut self, f: &mut Frame, area: ratatui::layout::Rect, state: &AppState, tx: mpsc::UnboundedSender<AppEvent>);
    fn handle_input(
        &mut self,
        key: KeyEvent,
        state: &mut AppState,
        tx: mpsc::UnboundedSender<AppEvent>,
    ) -> Result<()>;

    /// Returns true if this tab wants to handle the Esc key itself
    /// (e.g., to exit search mode) instead of quitting the application
    fn handles_esc(&self) -> bool {
        false
    }

    /// Allows downcasting to concrete tab types
    fn as_any_mut(&mut self) -> &mut dyn std::any::Any;
}
