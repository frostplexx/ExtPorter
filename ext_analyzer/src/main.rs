use anyhow::Result;
use ratatui::{
    backend::CrosstermBackend,
    crossterm::{
        event::{self, DisableMouseCapture, EnableMouseCapture, Event, KeyCode, KeyModifiers},
        execute,
        terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
    },
    Terminal,
};
use std::{io, sync::Arc};
use tokio::sync::{mpsc, Mutex};

mod app;
mod tabs;
mod theme;
mod websocket;

use app::{App, AppEvent};

#[tokio::main]
async fn main() -> Result<()> {
    // Load environment variables
    dotenv::dotenv().ok();

    // Setup terminal
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen, EnableMouseCapture)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    // Create application
    let (tx, rx) = mpsc::unbounded_channel();
    let ws_sender: websocket::WebSocketSender = Arc::new(Mutex::new(None));
    let mut app = App::new(tx.clone(), ws_sender.clone());

    // Spawn WebSocket task
    let event_tx = tx.clone();
    let ws_sender_clone = ws_sender.clone();
    tokio::spawn(async move {
        if let Err(e) = websocket::run_websocket_client(event_tx, ws_sender_clone).await {
            eprintln!("WebSocket error: {}", e);
        }
    });

    // Spawn input handler
    let input_tx = tx;
    tokio::spawn(async move {
        loop {
            if event::poll(std::time::Duration::from_millis(100)).unwrap() {
                if let Event::Key(key) = event::read().unwrap() {
                    if input_tx.send(AppEvent::Input(key)).is_err() {
                        break;
                    }
                }
            }
        }
    });

    // Run app
    let result = run_app(&mut terminal, &mut app, rx, ws_sender.clone()).await;

    // Restore terminal
    disable_raw_mode()?;
    execute!(
        terminal.backend_mut(),
        LeaveAlternateScreen,
        DisableMouseCapture
    )?;
    terminal.show_cursor()?;

    result
}

async fn run_app(
    terminal: &mut Terminal<CrosstermBackend<io::Stdout>>,
    app: &mut App,
    mut rx: mpsc::UnboundedReceiver<AppEvent>,
    ws_sender: websocket::WebSocketSender,
) -> Result<()> {
    // Create a ticker for regular redraws
    let mut redraw_interval = tokio::time::interval(std::time::Duration::from_millis(50));
    
    loop {
        tokio::select! {
            // Redraw on a timer (20 FPS)
            _ = redraw_interval.tick() => {
                terminal.draw(|f| app.draw(f))?;
            }
            
            // Handle events as they come in
            Some(event) = rx.recv() => {
                match event {
                    AppEvent::Input(key) => {
                        // Global quit handlers - Ctrl+C or Ctrl+Q only
                        if (key.code == KeyCode::Char('c')
                            && key.modifiers.contains(KeyModifiers::CONTROL))
                            || (key.code == KeyCode::Char('q')
                                && key.modifiers.contains(KeyModifiers::CONTROL))
                        {
                            return Ok(());
                        }

                        // Handle input (Esc is never used to quit)
                        app.handle_input(key)?;
                    }
                    AppEvent::WebSocketConnecting => {
                        app.handle_websocket_connecting();
                    }
                    AppEvent::WebSocketConnected => {
                        app.handle_websocket_connected();
                    }
                    AppEvent::WebSocketDisconnected => {
                        app.handle_websocket_disconnected();
                    }
                    AppEvent::WebSocketMessage(msg) => {
                        app.handle_websocket_message(msg);
                    }
                    AppEvent::WebSocketError(err) => {
                        app.handle_websocket_error(err);
                    }
                    AppEvent::SendWebSocketMessage(msg) => {
                        // Send message through WebSocket
                        if let Some(sender) = ws_sender.lock().await.as_ref() {
                            let _ = sender.send(msg);
                        }
                    }
                    AppEvent::ExtensionsLoaded(_) => {
                        // This is handled in handle_websocket_message, no action needed here
                    }
                    AppEvent::SwitchToTab(tab_index) => {
                        app.switch_to_tab(tab_index);
                    }
                    AppEvent::Quit => {
                        return Ok(());
                    }
                }
            }
            
            else => break,
        }
    }
    
    Ok(())
}
