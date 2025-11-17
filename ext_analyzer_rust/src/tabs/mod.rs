use anyhow::Result;
use crossterm::event::KeyEvent;
use ratatui::Frame;
use tokio::sync::mpsc;

use crate::app::{AppEvent, AppState};

pub mod analyzer;
pub mod database;
pub mod explorer;
pub mod migrator;
pub mod settings;

pub trait Tab: Send {
    fn render(&mut self, f: &mut Frame, area: ratatui::layout::Rect, state: &AppState);
    fn handle_input(
        &mut self,
        key: KeyEvent,
        state: &mut AppState,
        tx: mpsc::UnboundedSender<AppEvent>,
    ) -> Result<()>;
}
