use std::io::{Read, Write};
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};
use std::time::Duration;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum KittyError {
    #[error("Failed to connect to kitty socket: {0}")]
    Connection(#[from] std::io::Error),
    #[error("Kitty socket not found")]
    NotFound,
    #[error("Failed to send command: {0}")]
    SendError(String),
}

/// Remote control interface for Kitty terminal.
/// Uses Unix sockets to communicate with Kitty.
pub struct KittyRemote {
    socket_path: PathBuf,
}

impl KittyRemote {
    /// Try to find kitty socket from environment or common locations
    pub fn new() -> Option<Self> {
        // Check KITTY_LISTEN_ON environment variable first
        if let Ok(socket) = std::env::var("KITTY_LISTEN_ON") {
            let path = socket.strip_prefix("unix:").unwrap_or(&socket).to_string();
            let socket_path = PathBuf::from(path);

            if socket_path.exists() {
                tracing::debug!("Found kitty socket from KITTY_LISTEN_ON: {:?}", socket_path);
                return Some(Self { socket_path });
            }
        }

        // Try common socket locations
        let uid = unsafe { libc::getuid() };

        // Try /tmp/kitty-{uid}-*/kitty socket pattern
        if let Ok(entries) = std::fs::read_dir("/tmp") {
            for entry in entries.flatten() {
                let name = entry.file_name();
                let name_str = name.to_string_lossy();
                if name_str.starts_with(&format!("kitty-{}-", uid)) {
                    let socket_path = entry.path().join("kitty");
                    if socket_path.exists() {
                        tracing::debug!("Found kitty socket at: {:?}", socket_path);
                        return Some(Self { socket_path });
                    }
                }
            }
        }

        // Try XDG runtime dir
        if let Ok(runtime_dir) = std::env::var("XDG_RUNTIME_DIR") {
            let socket_path = PathBuf::from(runtime_dir).join("kitty");
            if socket_path.exists() {
                tracing::debug!("Found kitty socket in XDG_RUNTIME_DIR: {:?}", socket_path);
                return Some(Self { socket_path });
            }
        }

        tracing::debug!("No kitty socket found");
        None
    }

    /// Open extension folders side-by-side in a new kitty tab.
    /// Uses the user's default shell from $SHELL.
    pub fn open_extension_folders(
        &self,
        mv2_path: &Path,
        mv3_path: &Path,
    ) -> Result<(), KittyError> {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());

        let mv2_str = mv2_path.to_string_lossy();
        let mv3_str = mv3_path.to_string_lossy();

        // Create new tab with MV2 directory using user's default shell
        let new_tab_cmd = format!(
            r#"{{"cmd": "launch", "args": ["--type=tab", "--tab-title=MV2 vs MV3", "--cwd={}", "{}"]}}"#,
            mv2_str, shell
        );
        self.send_command(&new_tab_cmd)?;

        // Small delay to let the tab open
        std::thread::sleep(Duration::from_millis(150));

        // Create vertical split with MV3 directory
        let split_cmd = format!(
            r#"{{"cmd": "launch", "args": ["--type=window", "--cwd={}", "{}"]}}"#,
            mv3_str, shell
        );
        self.send_command(&split_cmd)?;

        Ok(())
    }

    /// Send a command to kitty via Unix socket
    fn send_command(&self, cmd: &str) -> Result<(), KittyError> {
        let mut stream = UnixStream::connect(&self.socket_path)?;
        stream.set_write_timeout(Some(Duration::from_secs(5)))?;
        stream.set_read_timeout(Some(Duration::from_secs(5)))?;

        // Kitty protocol: command followed by ESC backslash
        let message = format!("{}\x1b\\", cmd);
        stream.write_all(message.as_bytes())?;
        stream.flush()?;

        // Read response (optional, kitty may send OK or error)
        let mut response = vec![0u8; 1024];
        let _ = stream.read(&mut response); // Ignore read errors/timeouts

        Ok(())
    }

    /// Check if kitty socket is available
    pub fn is_available(&self) -> bool {
        self.socket_path.exists()
    }

    /// Get the socket path (for debugging)
    #[allow(dead_code)]
    pub fn socket_path(&self) -> &Path {
        &self.socket_path
    }
}

/// Check if kitty remote control is available.
/// Returns a helpful message if not available.
pub fn check_kitty_availability() -> Result<KittyRemote, String> {
    KittyRemote::new().ok_or_else(|| {
        "Kitty remote control not available. Start kitty with: kitty -o allow_remote_control=yes"
            .to_string()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_kitty_remote_new() {
        // This test just ensures the function doesn't panic
        // The result depends on the environment
        let _kitty = KittyRemote::new();
    }
}
