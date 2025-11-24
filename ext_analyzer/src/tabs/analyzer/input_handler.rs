use anyhow::Result;
use ratatui::crossterm::event::{KeyCode, KeyEvent};
use tokio::sync::mpsc;

use crate::{app::AppState, types::AppEvent};

pub fn handle_comparison_input(
    key: KeyEvent,
    state: &mut AppState,
    tx: mpsc::UnboundedSender<AppEvent>,
    mv2_browser_running: &mut bool,
    mv3_browser_running: &mut bool,
) -> Result<()> {
    match key.code {
        KeyCode::Char('o') | KeyCode::Char('O') => {
            // Launch both browsers using the selected extension from AppState
            if let Some(ref ext_id) = state.selected_extension_id {
                if let Some(_ext) = state.extensions.iter().find(|e| e.get_id() == *ext_id) {
                    let msg = format!("LAUNCH_DUAL:{}", ext_id);
                    let _ = tx.send(AppEvent::SendWebSocketMessage(msg));
                    *mv2_browser_running = true;
                    *mv3_browser_running = true;
                }
            }
        }
        KeyCode::Char('q') | KeyCode::Char('Q') => {
            // Close both browsers
            *mv2_browser_running = false;
            *mv3_browser_running = false;
            let _ = tx.send(AppEvent::SendWebSocketMessage("CLOSE_BROWSERS".to_string()));
        }
        _ => {}
    }
    Ok(())
}
