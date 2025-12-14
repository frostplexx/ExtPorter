use anyhow::{anyhow, Result};
use chromiumoxide::{Browser, BrowserConfig};
use futures_util::StreamExt;
use std::path::PathBuf;
use std::sync::Arc;
use tempfile::TempDir;
use tokio::sync::mpsc;

use crate::types::AppEvent;

#[derive(Debug)]
pub enum BrowserCommand {
    LaunchDual {
        mv2_path: PathBuf,
        mv3_path: PathBuf,
    },
    CloseBrowsers,
}

pub struct DualBrowserManager {
    mv2_browser: Option<Browser>,
    mv3_browser: Option<Browser>,
    _mv2_handler: Option<tokio::task::JoinHandle<()>>,
    _mv3_handler: Option<tokio::task::JoinHandle<()>>,
    _mv2_user_data: Option<TempDir>,
    _mv3_user_data: Option<TempDir>,
}

impl DualBrowserManager {
    pub fn new() -> Self {
        Self {
            mv2_browser: None,
            mv3_browser: None,
            _mv2_handler: None,
            _mv3_handler: None,
            _mv2_user_data: None,
            _mv3_user_data: None,
        }
    }

    fn get_chrome_path(is_mv3: bool) -> Result<PathBuf> {
        let env_var = if is_mv3 {
            "CHROME_LATESTS"
        } else {
            "CHROME_OLD"
        };
        let base = std::env::var(env_var).map_err(|_| anyhow!("{} not set", env_var))?;

        let path = PathBuf::from(&base);

        if !path.exists() {
            return Err(anyhow!("Chrome not found at {:?}", path));
        }
        Ok(path)
    }

    async fn launch_browser(
        chrome_path: PathBuf,
        extension_path: PathBuf,
        user_data_dir: &PathBuf,
    ) -> Result<(Browser, tokio::task::JoinHandle<()>)> {
        let config = BrowserConfig::builder()
            .chrome_executable(chrome_path)
            .with_head()
            .user_data_dir(user_data_dir)
            .no_sandbox()
            .disable_default_args()
            .arg(&format!(
                "--load-extension={}",
                extension_path.to_string_lossy()
            ))
            // From: https://github.com/puppeteer/puppeteer/blob/4846b8723cf20d3551c0d755df394cc5e0c82a94/src/node/Launcher.ts#L157
            // Removed --disable-extensions
            .arg("--disable-background-networking")
            .arg("--enable-features=NetworkService,NetworkServiceInProcess")
            .arg("--disable-background-timer-throttling")
            .arg("--disable-backgrounding-occluded-windows")
            .arg("--disable-breakpad")
            .arg("--disable-client-side-phishing-detection")
            .arg("--disable-component-extensions-with-background-pages")
            .arg("--disable-default-apps")
            .arg("--disable-dev-shm-usage")
            .arg("--disable-features=TranslateUI")
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
            .arg("--enable-blink-features=IdleDetection")
            .build()
            .map_err(|e| anyhow!("Config error: {}", e))?;

        tracing::debug!("Browser Config: {:?}", config);

        let (browser, mut handler) = Browser::launch(config)
            .await
            .map_err(|e| anyhow!("Failed to launch: {}", e))?;

        let handler_task = tokio::spawn(async move { while let Some(_) = handler.next().await {} });

        Ok((browser, handler_task))
    }

    pub async fn launch_dual(&mut self, mv2_path: PathBuf, mv3_path: PathBuf) -> Result<()> {
        self.close_all().await;

        if !mv2_path.join("manifest.json").exists() {
            return Err(anyhow!("MV2 manifest.json not found"));
        }
        if !mv3_path.join("manifest.json").exists() {
            return Err(anyhow!("MV3 manifest.json not found"));
        }

        let mv2_chrome = Self::get_chrome_path(false)?;
        let mv3_chrome = Self::get_chrome_path(true)?;

        tracing::info!("Launching MV2 browser: {:?}", mv2_path);
        tracing::info!("Launching MV3 browser: {:?}", mv3_path);

        let mv2_user_data =
            tempfile::tempdir().map_err(|e| anyhow!("Failed to create temp dir: {}", e))?;
        let mv3_user_data =
            tempfile::tempdir().map_err(|e| anyhow!("Failed to create temp dir: {}", e))?;

        let (mv2_browser, mv2_handler) =
            Self::launch_browser(mv2_chrome, mv2_path, &mv2_user_data.path().to_path_buf()).await?;

        let (mv3_browser, mv3_handler) =
            Self::launch_browser(mv3_chrome, mv3_path, &mv3_user_data.path().to_path_buf()).await?;

        self.mv2_browser = Some(mv2_browser);
        self.mv3_browser = Some(mv3_browser);
        self._mv2_handler = Some(mv2_handler);
        self._mv3_handler = Some(mv3_handler);
        self._mv2_user_data = Some(mv2_user_data);
        self._mv3_user_data = Some(mv3_user_data);

        tracing::info!("Both browsers launched");
        Ok(())
    }

    pub async fn close_all(&mut self) {
        if let Some(mut browser) = self.mv2_browser.take() {
            let _ = browser.close().await;
        }
        if let Some(mut browser) = self.mv3_browser.take() {
            let _ = browser.close().await;
        }
        if let Some(handler) = self._mv2_handler.take() {
            handler.abort();
        }
        if let Some(handler) = self._mv3_handler.take() {
            handler.abort();
        }
        self._mv2_user_data = None;
        self._mv3_user_data = None;
        tracing::debug!("Browsers closed");
    }
}

pub type SharedBrowserManager = Arc<tokio::sync::Mutex<DualBrowserManager>>;

pub fn create_shared_browser_manager() -> SharedBrowserManager {
    Arc::new(tokio::sync::Mutex::new(DualBrowserManager::new()))
}

pub async fn run_browser_manager(
    event_tx: mpsc::UnboundedSender<AppEvent>,
    mut cmd_rx: mpsc::UnboundedReceiver<BrowserCommand>,
    browser_manager: SharedBrowserManager,
) -> Result<()> {
    tracing::info!("Browser manager started");

    while let Some(cmd) = cmd_rx.recv().await {
        match cmd {
            BrowserCommand::LaunchDual { mv2_path, mv3_path } => {
                let mut manager = browser_manager.lock().await;
                match manager.launch_dual(mv2_path, mv3_path).await {
                    Ok(()) => {
                        let _ = event_tx.send(AppEvent::BrowserLaunched);
                    }
                    Err(e) => {
                        tracing::error!("Failed to launch browsers: {}", e);
                        let _ = event_tx.send(AppEvent::BrowserLaunchError(e.to_string()));
                    }
                }
            }
            BrowserCommand::CloseBrowsers => {
                let mut manager = browser_manager.lock().await;
                manager.close_all().await;
                let _ = event_tx.send(AppEvent::BrowserClosed);
            }
        }
    }

    let mut manager = browser_manager.lock().await;
    manager.close_all().await;
    tracing::info!("Browser manager stopped");
    Ok(())
}
