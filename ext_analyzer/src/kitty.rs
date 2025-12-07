use std::path::Path;
use std::process::Command;
use std::time::Duration;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum KittyError {
    #[error("Failed to execute kitty command: {0}")]
    CommandFailed(String),
    #[error("Kitty socket not found")]
    NotFound,
    #[error("Failed to send command: {0}")]
    SendError(String),
}

/// Remote control interface for Kitty terminal.
/// Uses the `kitten @` CLI for reliable communication.
pub struct KittyRemote {
    socket_path: String,
}

impl KittyRemote {
    /// Try to find kitty socket from environment or common locations
    pub fn new() -> Option<Self> {
        // Check KITTY_LISTEN_ON environment variable first
        if let Ok(socket) = std::env::var("KITTY_LISTEN_ON") {
            let path = socket.strip_prefix("unix:").unwrap_or(&socket).to_string();

            // Verify the socket exists
            if std::path::Path::new(&path).exists() {
                tracing::debug!("Found kitty socket from KITTY_LISTEN_ON: {:?}", path);
                return Some(Self { socket_path: path });
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
                        let path_str = socket_path.to_string_lossy().to_string();
                        tracing::debug!("Found kitty socket at: {:?}", path_str);
                        return Some(Self {
                            socket_path: path_str,
                        });
                    }
                }
            }
        }

        // Try XDG runtime dir
        if let Ok(runtime_dir) = std::env::var("XDG_RUNTIME_DIR") {
            let socket_path = std::path::PathBuf::from(runtime_dir).join("kitty");
            if socket_path.exists() {
                let path_str = socket_path.to_string_lossy().to_string();
                tracing::debug!("Found kitty socket in XDG_RUNTIME_DIR: {:?}", path_str);
                return Some(Self {
                    socket_path: path_str,
                });
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
        let mv2_str = mv2_path.to_string_lossy();
        let mv3_str = mv3_path.to_string_lossy();

        // Create new tab with MV2 directory
        tracing::debug!("Creating kitty tab with MV2 directory: {}", mv2_str);
        let output = Command::new("kitten")
            .args([
                "@",
                "--to",
                &format!("unix:{}", self.socket_path),
                "launch",
                "--type=tab",
                "--tab-title=MV2 vs MV3",
                &format!("--cwd={}", mv2_str),
            ])
            .output()
            .map_err(|e| KittyError::CommandFailed(e.to_string()))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            tracing::error!("Kitty launch tab failed: {}", stderr);
            return Err(KittyError::CommandFailed(stderr.to_string()));
        }

        // Small delay to let the tab open
        std::thread::sleep(Duration::from_millis(100));

        // Create vertical split with MV3 directory
        tracing::debug!("Creating kitty split with MV3 directory: {}", mv3_str);
        let output = Command::new("kitten")
            .args([
                "@",
                "--to",
                &format!("unix:{}", self.socket_path),
                "launch",
                "--type=window",
                &format!("--cwd={}", mv3_str),
            ])
            .output()
            .map_err(|e| KittyError::CommandFailed(e.to_string()))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            tracing::error!("Kitty launch window failed: {}", stderr);
            return Err(KittyError::CommandFailed(stderr.to_string()));
        }

        tracing::info!("Successfully opened kitty tab with extension folders");
        Ok(())
    }

    /// Check if kitty socket is available
    pub fn is_available(&self) -> bool {
        std::path::Path::new(&self.socket_path).exists()
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
