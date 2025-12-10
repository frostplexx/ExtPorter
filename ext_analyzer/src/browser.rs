use anyhow::{anyhow, Result};
use chromiumoxide::browser::{Browser, BrowserConfig};
use chromiumoxide::Page;
use futures::StreamExt;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tempfile::TempDir;
use tokio::sync::{mpsc, Mutex};
use tokio::task::JoinHandle;

use crate::types::AppEvent;

/// Status of an extension after browser launch
#[derive(Debug, Clone)]
pub enum ExtensionStatus {
    /// Extension loaded successfully
    Loaded { id: String, name: String },
    /// Extension found but disabled
    Disabled { id: String, name: String, reason: String },
    /// Extension had errors
    Error { id: String, message: String },
    /// No extension found in browser
    NotFound,
}

/// Commands that can be sent to the browser manager
#[derive(Debug)]
pub enum BrowserCommand {
    /// Launch dual browsers with MV2 and MV3 extensions
    LaunchDual {
        mv2_path: PathBuf,
        mv3_path: PathBuf,
    },
    /// Close all browsers
    CloseBrowsers,
}

/// Manages dual Chrome browser instances for extension testing.
/// One browser runs with an older Chrome version (CHROME_138) for MV2,
/// another runs with the latest Chrome (CHROME_LATESTS) for MV3.
pub struct DualBrowserManager {
    mv2_browser: Option<Browser>,
    mv3_browser: Option<Browser>,
    mv2_handler: Option<JoinHandle<()>>,
    mv3_handler: Option<JoinHandle<()>>,
    current_mv2_path: Option<PathBuf>,
    current_mv3_path: Option<PathBuf>,
    /// Temp directories for browser user data (keeps them alive)
    _mv2_user_data: Option<TempDir>,
    _mv3_user_data: Option<TempDir>,
    /// Extension load status for MV2 browser
    mv2_extension_status: Option<ExtensionStatus>,
    /// Extension load status for MV3 browser
    mv3_extension_status: Option<ExtensionStatus>,
}

impl DualBrowserManager {
    pub fn new() -> Self {
        Self {
            mv2_browser: None,
            mv3_browser: None,
            mv2_handler: None,
            mv3_handler: None,
            current_mv2_path: None,
            current_mv3_path: None,
            _mv2_user_data: None,
            _mv3_user_data: None,
            mv2_extension_status: None,
            mv3_extension_status: None,
        }
    }

    /// Get Chrome executable path from Nix environment variables.
    /// For MV2 (is_mv3=false): uses CHROME_138
    /// For MV3 (is_mv3=true): uses CHROME_LATESTS
    fn get_chrome_path(is_mv3: bool) -> Result<PathBuf> {
        let env_var = if is_mv3 { "CHROME_LATESTS" } else { "CHROME_138" };
        let base = std::env::var(env_var)
            .map_err(|_| anyhow!("{} not set. Make sure you're running in the Nix shell.", env_var))?;

        // Construct full path based on platform
        #[cfg(target_os = "macos")]
        let path = PathBuf::from(&base)
            .join("Applications/Google Chrome.app/Contents/MacOS/Google Chrome");

        #[cfg(target_os = "linux")]
        let path = PathBuf::from(&base).join("bin/google-chrome-stable");

        #[cfg(not(any(target_os = "macos", target_os = "linux")))]
        let path = PathBuf::from(&base);

        if !path.exists() {
            return Err(anyhow!("Chrome executable not found at {:?}", path));
        }

        tracing::debug!("Using Chrome at {:?} for {}", path, if is_mv3 { "MV3" } else { "MV2" });
        Ok(path)
    }

    /// Launch both browsers with their respective extensions
    pub async fn launch_dual(
        &mut self,
        mv2_path: PathBuf,
        mv3_path: PathBuf,
    ) -> Result<()> {
        // Close existing browsers first
        self.close_all().await;

        // Store paths for later use
        self.current_mv2_path = Some(mv2_path.clone());
        self.current_mv3_path = Some(mv3_path.clone());

        // Create unique user data directories to avoid singleton lock conflicts
        let mv2_user_data = TempDir::with_prefix("chrome_mv2_")
            .map_err(|e| anyhow!("Failed to create MV2 user data dir: {}", e))?;
        let mv3_user_data = TempDir::with_prefix("chrome_mv3_")
            .map_err(|e| anyhow!("Failed to create MV3 user data dir: {}", e))?;

        // Launch MV2 browser (Chrome 138)
        let mv2_chrome = Self::get_chrome_path(false)?;
        tracing::info!("Launching MV2 browser with extension: {:?}", mv2_path);
        
        // Verify extension directory structure
        let mv2_manifest = mv2_path.join("manifest.json");
        let mv3_manifest = mv3_path.join("manifest.json");
        
        if !mv2_manifest.exists() {
            tracing::error!("MV2 manifest.json not found at {:?}", mv2_manifest);
            // List contents of directory
            if let Ok(entries) = std::fs::read_dir(&mv2_path) {
                for entry in entries.flatten() {
                    tracing::debug!("  MV2 dir contains: {:?}", entry.path());
                }
            }
            return Err(anyhow!("MV2 manifest.json not found at {:?}", mv2_manifest));
        }
        if !mv3_manifest.exists() {
            tracing::error!("MV3 manifest.json not found at {:?}", mv3_manifest);
            if let Ok(entries) = std::fs::read_dir(&mv3_path) {
                for entry in entries.flatten() {
                    tracing::debug!("  MV3 dir contains: {:?}", entry.path());
                }
            }
            return Err(anyhow!("MV3 manifest.json not found at {:?}", mv3_manifest));
        }
        tracing::info!("Extension manifests verified at {:?} and {:?}", mv2_manifest, mv3_manifest);
        
        let mv2_config = BrowserConfig::builder()
            .chrome_executable(&mv2_chrome)
            .with_head()
            .window_size(900, 700)
            .user_data_dir(mv2_user_data.path())
            .disable_default_args() // chromiumoxide defaults include --disable-extensions which breaks extension loading
            .extension(mv2_path.to_string_lossy().to_string())
            // Essential args (from chromiumoxide defaults, minus --disable-extensions)
            .arg("--disable-background-networking")
            .arg("--enable-features=NetworkService,NetworkServiceInProcess")
            .arg("--disable-features=ExtensionManifestV2Deprecation,ExtensionManifestV2DeprecationWarning")
            .arg("--disable-background-timer-throttling")
            .arg("--disable-backgrounding-occluded-windows")
            .arg("--disable-breakpad")
            .arg("--disable-client-side-phishing-detection")
            .arg("--disable-default-apps")
            .arg("--disable-dev-shm-usage")
            .arg("--disable-hang-monitor")
            .arg("--disable-ipc-flooding-protection")
            .arg("--disable-popup-blocking")
            .arg("--disable-prompt-on-repost")
            .arg("--disable-renderer-backgrounding")
            .arg("--disable-sync")
            .arg("--force-color-profile=srgb")
            .arg("--metrics-recording-only")
            .arg("--no-first-run")
            .arg("--enable-automation")
            .arg("--password-store=basic")
            .arg("--use-mock-keychain")
            .arg("--no-default-browser-check")
            // Extension-specific args
            .arg(format!("--disable-extensions-except={}", mv2_path.to_string_lossy()))
            // Enable extension debugging features
            .arg("--enable-unsafe-extension-debugging")
            // Suppress "Chrome is being controlled by automated test software" infobar
            .arg("--silent-debugger-extension-api")
            // Allow file access for extensions (may help with loading)
            .arg("--allow-file-access-from-files")
            .build()
            .map_err(|e| anyhow!("Failed to build MV2 browser config: {}", e))?;

        let (mv2_browser, mut mv2_handler) = Browser::launch(mv2_config)
            .await
            .map_err(|e| anyhow!("Failed to launch MV2 browser: {}", e))?;

        // Spawn handler task for MV2
        let mv2_handle = tokio::spawn(async move {
            while mv2_handler.next().await.is_some() {}
        });

        // Launch MV3 browser (Latest Chrome)
        let mv3_chrome = Self::get_chrome_path(true)?;
        tracing::info!("Launching MV3 browser with extension: {:?}", mv3_path);

        let mv3_config = BrowserConfig::builder()
            .chrome_executable(&mv3_chrome)
            .with_head()
            .window_size(900, 700)
            .user_data_dir(mv3_user_data.path())
            .disable_default_args() // chromiumoxide defaults include --disable-extensions which breaks extension loading
            .extension(mv3_path.to_string_lossy().to_string())
            // Essential args (from chromiumoxide defaults, minus --disable-extensions)
            .arg("--disable-background-networking")
            .arg("--enable-features=NetworkService,NetworkServiceInProcess")
            .arg("--disable-background-timer-throttling")
            .arg("--disable-backgrounding-occluded-windows")
            .arg("--disable-breakpad")
            .arg("--disable-client-side-phishing-detection")
            .arg("--disable-default-apps")
            .arg("--disable-dev-shm-usage")
            .arg("--disable-hang-monitor")
            .arg("--disable-ipc-flooding-protection")
            .arg("--disable-popup-blocking")
            .arg("--disable-prompt-on-repost")
            .arg("--disable-renderer-backgrounding")
            .arg("--disable-sync")
            .arg("--force-color-profile=srgb")
            .arg("--metrics-recording-only")
            .arg("--no-first-run")
            .arg("--enable-automation")
            .arg("--password-store=basic")
            .arg("--use-mock-keychain")
            .arg("--no-default-browser-check")
            // Extension-specific args
            .arg(format!("--disable-extensions-except={}", mv3_path.to_string_lossy()))
            // Enable extension debugging features
            .arg("--enable-unsafe-extension-debugging")
            // Suppress "Chrome is being controlled by automated test software" infobar
            .arg("--silent-debugger-extension-api")
            // Allow file access for extensions (may help with loading)
            .arg("--allow-file-access-from-files")
            .build()
            .map_err(|e| anyhow!("Failed to build MV3 browser config: {}", e))?;

        let (mv3_browser, mut mv3_handler) = Browser::launch(mv3_config)
            .await
            .map_err(|e| anyhow!("Failed to launch MV3 browser: {}", e))?;

        // Spawn handler task for MV3
        let mv3_handle = tokio::spawn(async move {
            while mv3_handler.next().await.is_some() {}
        });

        self.mv2_browser = Some(mv2_browser);
        self.mv3_browser = Some(mv3_browser);
        self.mv2_handler = Some(mv2_handle);
        self.mv3_handler = Some(mv3_handle);
        
        // Keep temp directories alive as long as browsers are running
        self._mv2_user_data = Some(mv2_user_data);
        self._mv3_user_data = Some(mv3_user_data);

        // Wait for browsers to initialize and load extensions
        // Chrome 141+ may need more time to process extensions
        tokio::time::sleep(std::time::Duration::from_millis(2500)).await;

        // Check extension status for both browsers
        if let Some(ref browser) = self.mv2_browser {
            let status = Self::check_extension_status(browser).await;
            tracing::info!("MV2 extension status: {:?}", status);
            self.mv2_extension_status = Some(status);
        }

        if let Some(ref browser) = self.mv3_browser {
            let status = Self::check_extension_status(browser).await;
            tracing::info!("MV3 extension status: {:?}", status);
            self.mv3_extension_status = Some(status);
        }

        // Inject colored borders
        self.inject_borders().await?;

        // Open extension popup/options pages
        self.open_popup_pages().await?;

        Ok(())
    }

    /// Inject colored borders into all pages.
    /// Blue border for MV2, Red border for MV3.
    async fn inject_borders(&self) -> Result<()> {
        // Blue border for MV2
        if let Some(browser) = &self.mv2_browser {
            if let Ok(pages) = browser.pages().await {
                for page in pages {
                    let _ = Self::inject_border(&page, "blue").await;
                }
            }
        }

        // Red border for MV3
        if let Some(browser) = &self.mv3_browser {
            if let Ok(pages) = browser.pages().await {
                for page in pages {
                    let _ = Self::inject_border(&page, "red").await;
                }
            }
        }

        Ok(())
    }

    /// Inject a colored border into a page
    async fn inject_border(page: &Page, color: &str) -> Result<()> {
        let script = format!(
            r#"
            (function() {{
                const style = document.createElement('style');
                style.textContent = 'body {{ border: 5px solid {} !important; box-sizing: border-box !important; }}';
                if (document.head) {{
                    document.head.appendChild(style);
                }}
            }})();
            "#,
            color
        );

        page.evaluate(script).await.map_err(|e| anyhow!("Failed to inject border: {}", e))?;
        Ok(())
    }

    /// Get extension IDs from chrome://extensions page
    pub async fn get_extension_ids(&self) -> Result<(Option<String>, Option<String>)> {
        let mut mv2_id = None;
        let mut mv3_id = None;

        if let Some(browser) = &self.mv2_browser {
            mv2_id = Self::extract_extension_id(browser).await.ok().flatten();
        }

        if let Some(browser) = &self.mv3_browser {
            mv3_id = Self::extract_extension_id(browser).await.ok().flatten();
        }

        Ok((mv2_id, mv3_id))
    }

    /// Extract extension ID from a browser by navigating to chrome://extensions
    async fn extract_extension_id(browser: &Browser) -> Result<Option<String>> {
        let page = browser
            .new_page("chrome://extensions")
            .await
            .map_err(|e| anyhow!("Failed to open extensions page: {}", e))?;

        // Wait for extensions manager to load
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;

        // Extract extension ID via JavaScript
        let result = page
            .evaluate(
                r#"
                (() => {
                    const manager = document.querySelector('extensions-manager');
                    if (!manager || !manager.shadowRoot) return null;
                    const itemsList = manager.shadowRoot.querySelector('extensions-item-list');
                    if (!itemsList || !itemsList.shadowRoot) return null;
                    const items = itemsList.shadowRoot.querySelectorAll('extensions-item');
                    if (items.length === 0) return null;
                    return items[0].getAttribute('id');
                })()
                "#,
            )
            .await
            .map_err(|e| anyhow!("Failed to evaluate extension ID script: {}", e))?;

        let id = result.into_value::<Option<String>>().ok().flatten();

        // Close the extensions page
        let _ = page.close().await;

        Ok(id)
    }

    /// Open popup/options pages for both extensions
    async fn open_popup_pages(&self) -> Result<()> {
        let (mv2_id, mv3_id) = self.get_extension_ids().await?;

        // Open MV2 popup/options
        if let (Some(browser), Some(ext_id), Some(path)) = 
            (&self.mv2_browser, mv2_id, &self.current_mv2_path) 
        {
            let manifest = Self::read_manifest(path)?;
            Self::open_extension_pages(browser, &ext_id, &manifest, "blue").await?;
        }

        // Open MV3 popup/options
        if let (Some(browser), Some(ext_id), Some(path)) = 
            (&self.mv3_browser, mv3_id, &self.current_mv3_path) 
        {
            let manifest = Self::read_manifest(path)?;
            Self::open_extension_pages(browser, &ext_id, &manifest, "red").await?;
        }

        Ok(())
    }

    /// Read manifest.json from extension directory
    fn read_manifest(ext_path: &Path) -> Result<serde_json::Value> {
        let manifest_path = ext_path.join("manifest.json");
        let content = std::fs::read_to_string(&manifest_path)
            .map_err(|e| anyhow!("Failed to read manifest: {}", e))?;
        serde_json::from_str(&content).map_err(|e| anyhow!("Failed to parse manifest: {}", e))
    }

    /// Open extension popup/options pages in a browser
    async fn open_extension_pages(
        browser: &Browser,
        ext_id: &str,
        manifest: &serde_json::Value,
        border_color: &str,
    ) -> Result<()> {
        // Try to find popup path
        let popup_path = manifest
            .get("action")
            .or_else(|| manifest.get("browser_action"))
            .or_else(|| manifest.get("page_action"))
            .and_then(|a| a.get("default_popup"))
            .and_then(|p| p.as_str());

        if let Some(popup) = popup_path {
            let url = format!(
                "chrome-extension://{}/{}",
                ext_id,
                popup.trim_start_matches('/')
            );
            tracing::debug!("Opening popup: {}", url);
            if let Ok(page) = browser.new_page(&url).await {
                // Wait for page to load
                tokio::time::sleep(std::time::Duration::from_millis(300)).await;
                let _ = Self::inject_border(&page, border_color).await;
            }
        }

        // Try options page
        let options_path = manifest
            .get("options_page")
            .or_else(|| manifest.get("options_ui").and_then(|o| o.get("page")))
            .and_then(|p| p.as_str());

        if let Some(options) = options_path {
            let url = format!(
                "chrome-extension://{}/{}",
                ext_id,
                options.trim_start_matches('/')
            );
            tracing::debug!("Opening options: {}", url);
            if let Ok(page) = browser.new_page(&url).await {
                tokio::time::sleep(std::time::Duration::from_millis(300)).await;
                let _ = Self::inject_border(&page, border_color).await;
            }
        }

        Ok(())
    }

    /// Check extension status by querying chrome://extensions via CDP
    async fn check_extension_status(browser: &Browser) -> ExtensionStatus {
        let page = match browser.new_page("chrome://extensions").await {
            Ok(p) => p,
            Err(e) => {
                tracing::warn!("Failed to open chrome://extensions: {}", e);
                return ExtensionStatus::NotFound;
            }
        };

        // Wait for page to load
        tokio::time::sleep(std::time::Duration::from_millis(800)).await;

        let result = page
            .evaluate(
                r#"
            (() => {
                const manager = document.querySelector('extensions-manager');
                if (!manager || !manager.shadowRoot) return JSON.stringify({ status: 'not_found' });
                
                const itemsList = manager.shadowRoot.querySelector('extensions-item-list');
                if (!itemsList || !itemsList.shadowRoot) return JSON.stringify({ status: 'not_found' });
                
                const items = itemsList.shadowRoot.querySelectorAll('extensions-item');
                if (items.length === 0) return JSON.stringify({ status: 'not_found' });
                
                const item = items[0];
                const id = item.getAttribute('id') || '';
                const nameEl = item.shadowRoot?.querySelector('#name');
                const name = nameEl?.textContent?.trim() || 'Unknown';
                
                // Check for warnings/errors
                const warningsContainer = item.shadowRoot?.querySelector('.warnings-container');
                const warningText = warningsContainer?.textContent?.trim() || '';
                
                // Check if enabled via toggle
                const enableToggle = item.shadowRoot?.querySelector('cr-toggle');
                const isEnabled = enableToggle?.hasAttribute('checked') ?? true;
                
                if (!isEnabled) {
                    return JSON.stringify({ status: 'disabled', id, name, reason: warningText || 'Disabled by browser' });
                }
                if (warningText) {
                    return JSON.stringify({ status: 'error', id, name, message: warningText });
                }
                return JSON.stringify({ status: 'loaded', id, name });
            })()
            "#,
            )
            .await;

        let _ = page.close().await;

        // Parse result
        match result {
            Ok(val) => {
                if let Ok(json_str) = val.into_value::<String>() {
                    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&json_str) {
                        let status = parsed
                            .get("status")
                            .and_then(|s| s.as_str())
                            .unwrap_or("not_found");
                        let id = parsed
                            .get("id")
                            .and_then(|s| s.as_str())
                            .unwrap_or("")
                            .to_string();
                        let name = parsed
                            .get("name")
                            .and_then(|s| s.as_str())
                            .unwrap_or("Unknown")
                            .to_string();

                        return match status {
                            "loaded" => ExtensionStatus::Loaded { id, name },
                            "disabled" => {
                                let reason = parsed
                                    .get("reason")
                                    .and_then(|s| s.as_str())
                                    .unwrap_or("Unknown")
                                    .to_string();
                                ExtensionStatus::Disabled { id, name, reason }
                            }
                            "error" => {
                                let message = parsed
                                    .get("message")
                                    .and_then(|s| s.as_str())
                                    .unwrap_or("Unknown error")
                                    .to_string();
                                ExtensionStatus::Error { id, message }
                            }
                            _ => ExtensionStatus::NotFound,
                        };
                    }
                }
                ExtensionStatus::NotFound
            }
            Err(e) => {
                tracing::warn!("Failed to evaluate extension status script: {}", e);
                ExtensionStatus::NotFound
            }
        }
    }

    /// Get the extension status for both browsers
    pub fn get_extension_status(&self) -> (Option<ExtensionStatus>, Option<ExtensionStatus>) {
        (
            self.mv2_extension_status.clone(),
            self.mv3_extension_status.clone(),
        )
    }

    /// Close all browsers
    pub async fn close_all(&mut self) {
        if let Some(mut browser) = self.mv2_browser.take() {
            let _ = browser.close().await;
        }
        if let Some(mut browser) = self.mv3_browser.take() {
            let _ = browser.close().await;
        }

        // Cancel handler tasks
        if let Some(handle) = self.mv2_handler.take() {
            handle.abort();
        }
        if let Some(handle) = self.mv3_handler.take() {
            handle.abort();
        }

        self.current_mv2_path = None;
        self.current_mv3_path = None;
        
        // Drop temp directories (this will clean them up)
        self._mv2_user_data = None;
        self._mv3_user_data = None;
        
        // Reset extension status
        self.mv2_extension_status = None;
        self.mv3_extension_status = None;

        tracing::debug!("All browsers closed");
    }

    /// Check if any browser is currently running
    pub fn is_running(&self) -> bool {
        self.mv2_browser.is_some() || self.mv3_browser.is_some()
    }
}

impl Drop for DualBrowserManager {
    fn drop(&mut self) {
        // Note: Can't do async cleanup in drop, browsers will be cleaned up
        // when their handles are dropped
    }
}

/// Shared browser manager that can be accessed from multiple places
pub type SharedBrowserManager = Arc<Mutex<DualBrowserManager>>;

/// Create a new shared browser manager
pub fn create_shared_browser_manager() -> SharedBrowserManager {
    Arc::new(Mutex::new(DualBrowserManager::new()))
}

/// Run the browser manager loop, processing commands and emitting events
pub async fn run_browser_manager(
    event_tx: mpsc::UnboundedSender<AppEvent>,
    mut cmd_rx: mpsc::UnboundedReceiver<BrowserCommand>,
    browser_manager: SharedBrowserManager,
) -> Result<()> {
    tracing::info!("Browser manager started");

    while let Some(cmd) = cmd_rx.recv().await {
        match cmd {
            BrowserCommand::LaunchDual { mv2_path, mv3_path } => {
                tracing::info!("Received LaunchDual command");
                let mut manager = browser_manager.lock().await;
                
                match manager.launch_dual(mv2_path, mv3_path).await {
                    Ok(()) => {
                        tracing::info!("Browsers launched successfully");
                        let _ = event_tx.send(AppEvent::BrowserLaunched);

                        // Emit extension load status events
                        let (mv2_status, mv3_status) = manager.get_extension_status();

                        if let Some(status) = mv2_status {
                            let (loaded, id, name, error_message) = match status {
                                ExtensionStatus::Loaded { id, name } => {
                                    (true, Some(id), Some(name), None)
                                }
                                ExtensionStatus::Disabled { id, name, reason } => {
                                    (false, Some(id), Some(name), Some(reason))
                                }
                                ExtensionStatus::Error { id, message } => {
                                    (false, Some(id), None, Some(message))
                                }
                                ExtensionStatus::NotFound => {
                                    (false, None, None, Some("Extension not found".to_string()))
                                }
                            };
                            let _ = event_tx.send(AppEvent::ExtensionLoadStatus {
                                browser_type: "MV2".to_string(),
                                loaded,
                                id,
                                name,
                                error_message,
                            });
                        }

                        if let Some(status) = mv3_status {
                            let (loaded, id, name, error_message) = match status {
                                ExtensionStatus::Loaded { id, name } => {
                                    (true, Some(id), Some(name), None)
                                }
                                ExtensionStatus::Disabled { id, name, reason } => {
                                    (false, Some(id), Some(name), Some(reason))
                                }
                                ExtensionStatus::Error { id, message } => {
                                    (false, Some(id), None, Some(message))
                                }
                                ExtensionStatus::NotFound => {
                                    (false, None, None, Some("Extension not found".to_string()))
                                }
                            };
                            let _ = event_tx.send(AppEvent::ExtensionLoadStatus {
                                browser_type: "MV3".to_string(),
                                loaded,
                                id,
                                name,
                                error_message,
                            });
                        }
                    }
                    Err(e) => {
                        let error_msg = e.to_string();
                        tracing::error!("Failed to launch browsers: {}", error_msg);
                        let _ = event_tx.send(AppEvent::BrowserLaunchError(error_msg));
                    }
                }
            }
            BrowserCommand::CloseBrowsers => {
                tracing::info!("Received CloseBrowsers command");
                let mut manager = browser_manager.lock().await;
                manager.close_all().await;
                let _ = event_tx.send(AppEvent::BrowserClosed);
            }
        }
    }

    // Cleanup on exit
    {
        let mut manager = browser_manager.lock().await;
        manager.close_all().await;
    }

    tracing::info!("Browser manager stopped");
    Ok(())
}
