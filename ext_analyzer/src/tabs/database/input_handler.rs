use anyhow::Result;
use ratatui::crossterm::event::{KeyCode, KeyEvent};
use tokio::sync::mpsc;

use crate::{app::AppState, types::AppEvent};

use super::ViewMode;

pub fn handle_input(
    key: KeyEvent,
    _state: &mut AppState,
    _tx: mpsc::UnboundedSender<AppEvent>,
    view_mode: &mut ViewMode,
) -> Result<()> {
    match key.code {
        KeyCode::Char('m') => {
            *view_mode = match *view_mode {
                ViewMode::Collections => ViewMode::Query,
                ViewMode::Query => ViewMode::Collections,
            };
        }
        _ => {}
    }
    Ok(())
}
