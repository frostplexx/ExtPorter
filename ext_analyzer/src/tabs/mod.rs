use anyhow::Result;
use ratatui::{crossterm::event::KeyEvent, Frame};
use tokio::sync::mpsc;

use crate::{app::AppState, types::AppEvent};

pub mod analyzer;
pub mod database;
pub mod explorer;
pub mod migrator;

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

    /// Allows downcasting to concrete tab types
    #[allow(dead_code)]
    fn as_any_mut(&mut self) -> &mut dyn std::any::Any;
}
