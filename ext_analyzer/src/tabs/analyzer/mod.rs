use anyhow::Result;
use ratatui::{crossterm::event::KeyEvent, Frame};
use ratatui_image::protocol::StatefulProtocol;
use tokio::sync::mpsc;

use crate::{app::AppState, types::AppEvent};

mod image_handler;
mod input_handler;
mod renderer;
mod report_form;

pub use image_handler::ImageHandler;
pub use report_form::{ListenerStatus, ReportForm};

pub struct AnalyzerTab {
    mv2_browser_running: bool,
    mv3_browser_running: bool,
    event_count: u32,
    image_handler: ImageHandler,
    last_displayed_ext_id: Option<String>,
    // Store image protocols for rendering (dynamic number based on available images)
    image_protocols: Vec<Option<StatefulProtocol>>,
    // Report form for testing
    report_form: Option<ReportForm>,
}

impl AnalyzerTab {
    pub fn new() -> Self {
        Self {
            mv2_browser_running: false,
            mv3_browser_running: false,
            event_count: 0,
            image_handler: ImageHandler::new(),
            last_displayed_ext_id: None,
            image_protocols: Vec::new(),
            report_form: None,
        }
    }
}

impl super::Tab for AnalyzerTab {
    fn render(
        &mut self,
        f: &mut Frame,
        area: ratatui::layout::Rect,
        state: &AppState,
        tx: mpsc::UnboundedSender<AppEvent>,
    ) {
        renderer::render_comparison_mode(
            f,
            area,
            state,
            tx,
            self.mv2_browser_running,
            self.mv3_browser_running,
            self.event_count,
            &mut self.image_handler,
            &mut self.last_displayed_ext_id,
            &mut self.image_protocols,
            &mut self.report_form,
        );
    }

    fn handle_input(
        &mut self,
        key: KeyEvent,
        state: &mut AppState,
        tx: mpsc::UnboundedSender<AppEvent>,
    ) -> Result<()> {
        input_handler::handle_comparison_input(
            key,
            state,
            tx,
            &mut self.mv2_browser_running,
            &mut self.mv3_browser_running,
            &mut self.report_form,
        )
    }

    #[allow(dead_code)]
    fn as_any_mut(&mut self) -> &mut dyn std::any::Any {
        self
    }
}
