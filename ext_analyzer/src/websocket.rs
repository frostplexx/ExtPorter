use anyhow::Result;
use futures_util::{SinkExt, StreamExt};
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};
use tokio_tungstenite::{connect_async, tungstenite::Message};

use crate::app::AppEvent;

fn get_ws_url() -> String {
    std::env::var("WS_URL").unwrap_or_else(|_| "ws://localhost:8080".to_string())
}

pub type WebSocketSender = Arc<Mutex<Option<mpsc::UnboundedSender<String>>>>;

pub async fn run_websocket_client(
    event_tx: mpsc::UnboundedSender<AppEvent>,
    ws_sender: WebSocketSender,
) -> Result<()> {
    loop {
        // Notify that we're attempting to connect
        let _ = event_tx.send(AppEvent::WebSocketConnecting);
        
        match connect_and_run(&event_tx, &ws_sender).await {
            Ok(_) => {
                // Connection closed normally
                let _ = event_tx.send(AppEvent::WebSocketDisconnected);
                // Clear sender
                *ws_sender.lock().await = None;
            }
            Err(e) => {
                // Connection error
                let _ = event_tx.send(AppEvent::WebSocketError(e.to_string()));
                let _ = event_tx.send(AppEvent::WebSocketDisconnected);
                // Clear sender
                *ws_sender.lock().await = None;
            }
        }

        // Wait before reconnecting
        tokio::time::sleep(tokio::time::Duration::from_secs(3)).await;
    }
}

async fn connect_and_run(
    tx: &mpsc::UnboundedSender<AppEvent>,
    ws_sender: &WebSocketSender,
) -> Result<()> {
    let ws_url = get_ws_url();
    let (ws_stream, _) = connect_async(&ws_url).await?;
    let _ = tx.send(AppEvent::WebSocketConnected);

    let (mut write, mut read) = ws_stream.split();

    // Create channel for sending messages to WebSocket
    let (send_tx, mut send_rx) = mpsc::unbounded_channel::<String>();

    // Store sender in shared state
    *ws_sender.lock().await = Some(send_tx.clone());

    // Request extensions list with stats on connection
    let extensions_request = r#"{"type":"db_query","id":"get_extensions","method":"getExtensionsWithStats","params":{}}"#;
    let _ = send_tx.send(extensions_request.to_string());

    loop {
        tokio::select! {
            // Handle incoming messages from WebSocket
            msg = read.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        let _ = tx.send(AppEvent::WebSocketMessage(text));
                    }
                    Some(Ok(Message::Close(_))) => {
                        break;
                    }
                    Some(Err(e)) => {
                        return Err(e.into());
                    }
                    None => {
                        break;
                    }
                    _ => {}
                }
            }
            // Handle outgoing messages from application
            msg = send_rx.recv() => {
                match msg {
                    Some(text) => {
                        if let Err(e) = write.send(Message::Text(text)).await {
                            let _ = tx.send(AppEvent::WebSocketError(format!("Failed to send message: {}", e)));
                            break;
                        }
                    }
                    None => {
                        // Channel closed
                        break;
                    }
                }
            }
        }
    }

    Ok(())
}
