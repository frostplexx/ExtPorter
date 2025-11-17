use anyhow::Result;
use futures_util::StreamExt;
use tokio::sync::mpsc;
use tokio_tungstenite::{connect_async, tungstenite::Message};

use crate::app::AppEvent;

const WS_URL: &str = "ws://localhost:8080";

pub async fn run_websocket_client(tx: mpsc::UnboundedSender<AppEvent>) -> Result<()> {
    loop {
        match connect_and_run(&tx).await {
            Ok(_) => {
                // Connection closed normally
                let _ = tx.send(AppEvent::WebSocketDisconnected);
            }
            Err(e) => {
                // Connection error
                let _ = tx.send(AppEvent::WebSocketError(e.to_string()));
                let _ = tx.send(AppEvent::WebSocketDisconnected);
            }
        }

        // Wait before reconnecting
        tokio::time::sleep(tokio::time::Duration::from_secs(3)).await;
    }
}

async fn connect_and_run(tx: &mpsc::UnboundedSender<AppEvent>) -> Result<()> {
    let (ws_stream, _) = connect_async(WS_URL).await?;
    let _ = tx.send(AppEvent::WebSocketConnected);

    let (_write, mut read) = ws_stream.split();

    loop {
        tokio::select! {
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
        }
    }

    Ok(())
}
