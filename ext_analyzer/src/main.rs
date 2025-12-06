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
use tracing_subscriber::{fmt, prelude::*, EnvFilter};

mod app;
mod browser;
mod extension_downloader;
mod kitty;
mod listener_labels;
mod tabs;
mod theme;
mod types;
mod websocket;

use app::App;
use browser::{create_shared_browser_manager, run_browser_manager, BrowserCommand};
use extension_downloader::ExtensionDownloader;
use types::AppEvent;

#[tokio::main]
async fn main() -> Result<()> {
    // Load environment variables
    dotenv::dotenv().ok();
    
    // Setup tracing with file output (since terminal is used for UI)
    let log_file = std::fs::File::create("/tmp/ext_analyzer.log").ok();
    if let Some(file) = log_file {
        let file_layer = fmt::layer()
            .with_writer(file)
            .with_ansi(false);
        
        tracing_subscriber::registry()
            .with(EnvFilter::from_default_env().add_directive("ext_analyzer=debug".parse().unwrap()))
            .with(file_layer)
            .init();
    }

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

    // Create extension downloader
    let extension_downloader = Arc::new(Mutex::new(
        ExtensionDownloader::new().expect("Failed to create extension downloader"),
    ));

    // Create browser manager
    let browser_manager = create_shared_browser_manager();
    let (browser_cmd_tx, browser_cmd_rx) = mpsc::unbounded_channel::<BrowserCommand>();

    // Spawn browser manager task
    let browser_event_tx = tx.clone();
    let browser_manager_clone = browser_manager.clone();
    tokio::spawn(async move {
        if let Err(e) = run_browser_manager(browser_event_tx, browser_cmd_rx, browser_manager_clone).await {
            tracing::error!("Browser manager error: {}", e);
        }
    });

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
    let result = run_app(
        &mut terminal,
        &mut app,
        rx,
        ws_sender.clone(),
        extension_downloader,
        browser_cmd_tx,
    )
    .await;

    // Cleanup: close browsers before exiting
    {
        let mut manager = browser_manager.lock().await;
        manager.close_all().await;
    }

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
    extension_downloader: Arc<Mutex<ExtensionDownloader>>,
    browser_cmd_tx: mpsc::UnboundedSender<BrowserCommand>,
) -> Result<()> {
    // Create a ticker for regular redraws (60 FPS for smooth animations)
    let mut redraw_interval = tokio::time::interval(std::time::Duration::from_millis(16));
    
    loop {
        tokio::select! {
            // Redraw on a timer (~60 FPS for smooth animations)
            _ = redraw_interval.tick() => {
                terminal.draw(|f| {
                    app.draw(f);
                })?;
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
                    AppEvent::WebSocketBinaryMessage(data) => {
                        // Handle binary extension download data
                        handle_binary_extension_data(app, &extension_downloader, data).await;
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
                    AppEvent::LoadNextUntestedExtension => {
                        app.handle_load_next_untested_extension();
                    }
                    AppEvent::LoadPreviousUntestedExtension => {
                        app.handle_load_previous_untested_extension();
                    }
                    AppEvent::LoadFirstUntestedExtension => {
                        app.handle_load_first_untested_extension();
                    }
                    AppEvent::LLMDescriptionReceived(ext_id, description) => {
                        app.handle_llm_description_received(ext_id, description);
                    }
                    AppEvent::LLMDescriptionError(ext_id, error) => {
                        app.handle_llm_description_error(ext_id, error);
                    }
                    AppEvent::LLMFixStarted(ext_id) => {
                        app.handle_llm_fix_started(ext_id);
                    }
                    AppEvent::LLMFixSuccess(ext_id, modified_files) => {
                        app.handle_llm_fix_success(ext_id, modified_files);
                    }
                    AppEvent::LLMFixError(ext_id, error) => {
                        app.handle_llm_fix_error(ext_id, error);
                    }

                    // Extension download events
                    AppEvent::DownloadExtension(ext_id) => {
                        // Request extension download from server
                        app.handle_extension_download_started(ext_id.clone());
                        
                        // Check if we have it cached with same hash
                        let downloader = extension_downloader.lock().await;
                        let cached_hash = downloader.get_cached_hash(&ext_id);
                        drop(downloader);
                        
                        let msg = if let Some(hash) = cached_hash {
                            format!("DOWNLOAD_EXTENSION:{}:{}", ext_id, hash)
                        } else {
                            format!("DOWNLOAD_EXTENSION:{}", ext_id)
                        };
                        
                        if let Some(sender) = ws_sender.lock().await.as_ref() {
                            let _ = sender.send(msg);
                        }
                    }
                    AppEvent::ExtensionDownloadStarted(ext_id) => {
                        app.handle_extension_download_started(ext_id);
                    }
                    AppEvent::ExtensionDownloaded(ext_id, mv2_path, mv3_path) => {
                        app.handle_extension_downloaded(ext_id, mv2_path, mv3_path);
                    }
                    AppEvent::ExtensionDownloadCached(ext_id, mv2_path, mv3_path) => {
                        app.handle_extension_download_cached(ext_id, mv2_path, mv3_path);
                    }
                    AppEvent::ExtensionDownloadCacheHit(ext_id) => {
                        // Server confirmed our cached version is valid - get paths from downloader
                        let mut downloader = extension_downloader.lock().await;
                        downloader.touch_cached(&ext_id);
                        if let Some((mv2_path, mv3_path)) = downloader.get_cached(&ext_id) {
                            app.handle_extension_download_cached(ext_id, mv2_path, mv3_path);
                        } else {
                            app.handle_extension_download_error(
                                ext_id,
                                "Cache inconsistency: server confirmed cache but local cache missing".to_string(),
                            );
                        }
                    }
                    AppEvent::ExtensionDownloadError(ext_id, error) => {
                        app.handle_extension_download_error(ext_id, error);
                    }

                    // Browser events
                    AppEvent::LaunchBrowsers(mv2_path, mv3_path) => {
                        let _ = browser_cmd_tx.send(BrowserCommand::LaunchDual {
                            mv2_path,
                            mv3_path,
                        });
                    }
                    AppEvent::BrowserLaunched => {
                        app.handle_browser_launched();
                    }
                    AppEvent::BrowserLaunchError(error) => {
                        app.handle_browser_launch_error(error);
                    }
                    AppEvent::BrowserClosed => {
                        app.handle_browser_closed();
                    }
                    AppEvent::CloseBrowsersCmd => {
                        let _ = browser_cmd_tx.send(BrowserCommand::CloseBrowsers);
                    }
                    AppEvent::ExtensionLoadStatus {
                        browser_type,
                        loaded,
                        id,
                        name,
                        error_message,
                    } => {
                        app.handle_extension_load_status(
                            browser_type,
                            loaded,
                            id,
                            name,
                            error_message,
                        );
                    }

                    // Kitty events
                    AppEvent::OpenKittyTab(mv2_path, mv3_path) => {
                        handle_kitty_tab_open(app, mv2_path, mv3_path);
                    }
                    AppEvent::KittyTabOpened => {
                        app.handle_kitty_tab_opened();
                    }
                    AppEvent::KittyTabError(error) => {
                        app.handle_kitty_tab_error(error);
                    }
                }
            }
            
            else => break,
        }
    }
    
    Ok(())
}

/// Handle binary extension data from WebSocket
async fn handle_binary_extension_data(
    app: &mut App,
    extension_downloader: &Arc<Mutex<ExtensionDownloader>>,
    data: Vec<u8>,
) {
    // Binary format from server:
    // Text header: "DOWNLOAD_EXTENSION_START:{ext_id}:{size}:{hash}\n"
    // Then binary: [4B mv2_size][mv2.tar.gz][4B mv3_size][mv3.tar.gz]
    //
    // Or for cached: Text "DOWNLOAD_EXTENSION_CACHED:{ext_id}\n"

    // Try to find newline separator for header
    if let Some(newline_pos) = data.iter().position(|&b| b == b'\n') {
        let header = String::from_utf8_lossy(&data[..newline_pos]);
        
        if header.starts_with("DOWNLOAD_EXTENSION_CACHED:") {
            // Hash matched, use cached version
            if let Some(ext_id) = header.strip_prefix("DOWNLOAD_EXTENSION_CACHED:") {
                let mut downloader = extension_downloader.lock().await;
                downloader.touch_cached(ext_id);
                if let Some((mv2_path, mv3_path)) = downloader.get_cached(ext_id) {
                    app.handle_extension_download_cached(
                        ext_id.to_string(),
                        mv2_path,
                        mv3_path,
                    );
                } else {
                    app.handle_extension_download_error(
                        ext_id.to_string(),
                        "Cache inconsistency".to_string(),
                    );
                }
            }
        } else if header.starts_with("DOWNLOAD_EXTENSION_START:") {
            // New download: DOWNLOAD_EXTENSION_START:{ext_id}:{size}:{hash}
            let parts: Vec<&str> = header
                .strip_prefix("DOWNLOAD_EXTENSION_START:")
                .unwrap_or("")
                .split(':')
                .collect();
            
            if parts.len() >= 3 {
                let ext_id = parts[0];
                // parts[1] is size (not needed, we have the data)
                let hash = parts[2];
                let binary_data = &data[newline_pos + 1..];
                
                let mut downloader = extension_downloader.lock().await;
                match downloader.extract_extension(ext_id, binary_data, hash) {
                    Ok((mv2_path, mv3_path)) => {
                        app.handle_extension_downloaded(
                            ext_id.to_string(),
                            mv2_path,
                            mv3_path,
                        );
                    }
                    Err(e) => {
                        app.handle_extension_download_error(
                            ext_id.to_string(),
                            e.to_string(),
                        );
                    }
                }
            } else {
                tracing::error!("Invalid DOWNLOAD_EXTENSION_START header: {}", header);
            }
        } else if header.starts_with("DOWNLOAD_EXTENSION_ERROR:") {
            // Error from server: DOWNLOAD_EXTENSION_ERROR:{ext_id}:{error}
            let parts: Vec<&str> = header
                .strip_prefix("DOWNLOAD_EXTENSION_ERROR:")
                .unwrap_or("")
                .splitn(2, ':')
                .collect();
            
            if parts.len() >= 2 {
                app.handle_extension_download_error(
                    parts[0].to_string(),
                    parts[1].to_string(),
                );
            }
        }
    }
}

/// Handle opening kitty tab with extension folders
fn handle_kitty_tab_open(app: &mut App, mv2_path: std::path::PathBuf, mv3_path: std::path::PathBuf) {
    match kitty::check_kitty_availability() {
        Ok(kitty_remote) => {
            match kitty_remote.open_extension_folders(&mv2_path, &mv3_path) {
                Ok(()) => {
                    app.handle_kitty_tab_opened();
                }
                Err(e) => {
                    app.handle_kitty_tab_error(e.to_string());
                }
            }
        }
        Err(e) => {
            app.handle_kitty_tab_error(e);
        }
    }
}
