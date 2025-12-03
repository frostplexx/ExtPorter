use ratatui::{
    layout::{Constraint, Direction, Layout, Rect},
    style::{Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, List, ListItem, Paragraph, Wrap},
    Frame,
};
use serde::{Deserialize, Serialize};
use std::time::Instant;

use crate::{app::AppState, listener_labels::get_listener_label, types::Extension};

/// Status of a listener test
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ListenerStatus {
    Untested,
    Working,
    NotWorking,
}

impl ListenerStatus {
    pub fn cycle(&self) -> Self {
        match self {
            ListenerStatus::Untested => ListenerStatus::Working,
            ListenerStatus::Working => ListenerStatus::NotWorking,
            ListenerStatus::NotWorking => ListenerStatus::Untested,
        }
    }

    pub fn as_str(&self) -> &str {
        match self {
            ListenerStatus::Untested => "untested",
            ListenerStatus::Working => "yes",
            ListenerStatus::NotWorking => "no",
        }
    }

    pub fn display_char(&self) -> &str {
        match self {
            ListenerStatus::Untested => "?",
            ListenerStatus::Working => "✓",
            ListenerStatus::NotWorking => "✗",
        }
    }
}

/// Overall working status (tri-state)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum WorkingStatus {
    Yes,
    No,
    CouldNotTest,
}

impl WorkingStatus {
    pub fn cycle(&self) -> Self {
        match self {
            WorkingStatus::Yes => WorkingStatus::No,
            WorkingStatus::No => WorkingStatus::CouldNotTest,
            WorkingStatus::CouldNotTest => WorkingStatus::Yes,
        }
    }

    pub fn as_str(&self) -> &str {
        match self {
            WorkingStatus::Yes => "yes",
            WorkingStatus::No => "no",
            WorkingStatus::CouldNotTest => "could_not_test",
        }
    }

    pub fn display_str(&self) -> &str {
        match self {
            WorkingStatus::Yes => "Yes",
            WorkingStatus::No => "No",
            WorkingStatus::CouldNotTest => "Could not test",
        }
    }
}

/// Test result for a single listener
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListenerTestResult {
    pub api: String,
    pub file: String,
    pub line: Option<u32>,
    pub status: ListenerStatus,
}

/// Field types in the form
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FormField {
    Listener(usize),   // Index into listeners vec
    Installs,          // Does the extension install successfully?
    WorksInMv2,        // Does it work in MV2?
    NeedsLogin,        // Does it need login to test?
    IsPopupWorking,    // Is the popup working? (conditional - only if has popup)
    IsSettingsWorking, // Are the settings working? (conditional - only if has settings)
    IsNewTabWorking,   // Is the new tab working? (conditional - only if new tab extension)
    IsInteresting,     // Is this extension interesting for research?
    OverallWorking,    // Does it basically work? (tri-state) - moved to bottom
    Notes,             // Freeform text (optional)
    Submit,
}

/// Custom field for extensibility
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomField {
    pub key: String,
    pub value: String,
    pub field_type: String, // "text", "boolean", "number", etc.
}

/// Main report form state
#[derive(Debug, Clone)]
pub struct ReportForm {
    // Automatically collected data
    pub extension_name: String,
    pub mv2_id: Option<String>,
    pub mv3_id: Option<String>,
    pub extension_id: String,
    verification_start_time: Option<Instant>,
    verification_duration_secs: Option<f64>,

    // Manually collected data - Quick Assessment
    pub installs: bool,                 // Does it install successfully?
    pub works_in_mv2: bool,             // Does it work in MV2?
    pub needs_login: bool,              // Does it need login to test?
    pub is_popup_working: bool,         // Is the popup working?
    pub is_settings_working: bool,      // Are the settings working?
    pub is_new_tab_working: bool,       // Is the new tab working?
    pub is_interesting: bool,           // Is it interesting for research?
    pub overall_working: WorkingStatus, // Does it basically work? (tri-state)
    pub notes: String,                  // Optional notes

    // Per-listener testing
    pub listeners: Vec<ListenerTestResult>,

    // Manifest metadata (for conditional fields)
    pub has_popup: bool,
    pub has_settings: bool,
    pub is_new_tab_extension: bool,

    // Form state
    pub active_field: FormField,
    pub visible: bool,
    pub notes_cursor_pos: usize,

    // Edit mode
    pub is_editing: bool,
    pub report_id: Option<String>,
    pub created_at: Option<f64>,

    // Extensibility
    pub custom_fields: Vec<CustomField>,
}

impl ReportForm {
    /// Create a new report form from an extension
    pub fn new(extension: &Extension) -> Self {
        let listeners: Vec<ListenerTestResult> = extension
            .event_listeners
            .iter()
            .map(|listener| ListenerTestResult {
                api: listener.api.clone(),
                file: listener.file.clone(),
                line: listener.line,
                status: ListenerStatus::Untested,
            })
            .collect();

        // Check if extension has popup or settings in manifest
        let manifest = extension.manifest.as_ref();
        let has_popup = manifest
            .and_then(|m| m.as_object())
            .map(|obj| {
                obj.get("action")
                    .and_then(|a| a.get("default_popup"))
                    .is_some()
                    || obj
                        .get("browser_action")
                        .and_then(|a| a.get("default_popup"))
                        .is_some()
                    || obj
                        .get("page_action")
                        .and_then(|a| a.get("default_popup"))
                        .is_some()
            })
            .unwrap_or(false);

        let has_settings = manifest
            .and_then(|m| m.as_object())
            .map(|obj| {
                obj.get("options_page").is_some()
                    || obj.get("options_ui").and_then(|o| o.get("page")).is_some()
            })
            .unwrap_or(false);

        let is_new_tab_extension = manifest
            .and_then(|m| m.as_object())
            .and_then(|obj| obj.get("chrome_url_overrides"))
            .and_then(|overrides| overrides.get("newtab"))
            .and_then(|newtab| newtab.as_str())
            .map(|s| !s.is_empty())
            .unwrap_or(false);

        let first_field = if !listeners.is_empty() {
            FormField::Listener(0)
        } else {
            FormField::Installs
        };

        Self {
            extension_name: extension.name.clone(),
            mv2_id: extension.mv2_extension_id.clone(),
            mv3_id: extension.mv3_extension_id.clone(),
            extension_id: extension.get_id(),
            verification_start_time: None,
            verification_duration_secs: None,
            installs: true,     // Default to true
            works_in_mv2: true, // Default to true
            needs_login: false,
            is_popup_working: true,    // Default to true
            is_settings_working: true, // Default to true
            is_new_tab_working: true,  // Default to true
            is_interesting: false,
            overall_working: WorkingStatus::Yes, // Default optimistic
            notes: String::new(),
            listeners,
            has_popup,
            has_settings,
            is_new_tab_extension,
            active_field: first_field,
            visible: false,
            notes_cursor_pos: 0,
            is_editing: false,
            report_id: None,
            created_at: None,
            custom_fields: Vec::new(),
        }
    }

    /// Create form from existing report (for editing)
    pub fn from_report(extension: &Extension, report: &crate::types::Report) -> Self {
        let mut form = Self::new(extension);

        // Load report data
        form.is_editing = true;
        form.report_id = Some(report.id.clone());
        form.created_at = Some(report.created_at);
        form.verification_duration_secs = report.verification_duration_secs;
        form.installs = report.installs.unwrap_or(true);
        form.works_in_mv2 = report.works_in_mv2.unwrap_or(true);
        form.needs_login = report.needs_login.unwrap_or(false);
        form.is_popup_working = report.is_popup_working.unwrap_or(true);
        form.is_settings_working = report.is_settings_working.unwrap_or(true);
        form.is_new_tab_working = report.is_new_tab_working.unwrap_or(true);
        form.is_interesting = report.is_interesting.unwrap_or(false);
        form.overall_working = match report.overall_working.as_deref() {
            Some("yes") => WorkingStatus::Yes,
            Some("no") => WorkingStatus::No,
            Some("could_not_test") => WorkingStatus::CouldNotTest,
            _ => WorkingStatus::Yes,
        };
        form.notes = report.notes.clone().unwrap_or_default();
        form.notes_cursor_pos = form.notes.len();

        // Load listener statuses
        for listener_result in &report.listeners {
            if let Some(listener) = form
                .listeners
                .iter_mut()
                .find(|l| l.api == listener_result.api)
            {
                listener.status = match listener_result.status.as_str() {
                    "yes" => ListenerStatus::Working,
                    "no" => ListenerStatus::NotWorking,
                    _ => ListenerStatus::Untested,
                };
            }
        }

        form
    }

    /// Reset the form for a new extension
    pub fn reset(&mut self, extension: &Extension) {
        *self = Self::new(extension);
    }

    /// Start verification timing
    pub fn start_verification(&mut self) {
        self.verification_start_time = Some(Instant::now());
        self.visible = true;
    }

    /// Stop verification and calculate duration
    pub fn stop_verification(&mut self) {
        if let Some(start) = self.verification_start_time {
            self.verification_duration_secs = Some(start.elapsed().as_secs_f64());
        }
    }

    /// Get verification duration (current if still running)
    pub fn get_verification_duration(&self) -> Option<f64> {
        if let Some(duration) = self.verification_duration_secs {
            Some(duration)
        } else if let Some(start) = self.verification_start_time {
            Some(start.elapsed().as_secs_f64())
        } else {
            None
        }
    }

    /// Navigate to next field
    pub fn next_field(&mut self) {
        self.active_field = match self.active_field {
            FormField::Listener(idx) => {
                if idx + 1 < self.listeners.len() {
                    FormField::Listener(idx + 1)
                } else {
                    FormField::Installs
                }
            }
            FormField::Installs => FormField::WorksInMv2,
            FormField::WorksInMv2 => FormField::NeedsLogin,
            FormField::NeedsLogin => {
                if self.has_popup {
                    FormField::IsPopupWorking
                } else if self.has_settings {
                    FormField::IsSettingsWorking
                } else if self.is_new_tab_extension {
                    FormField::IsNewTabWorking
                } else {
                    FormField::IsInteresting
                }
            }
            FormField::IsPopupWorking => {
                if self.has_settings {
                    FormField::IsSettingsWorking
                } else if self.is_new_tab_extension {
                    FormField::IsNewTabWorking
                } else {
                    FormField::IsInteresting
                }
            }
            FormField::IsSettingsWorking => {
                if self.is_new_tab_extension {
                    FormField::IsNewTabWorking
                } else {
                    FormField::IsInteresting
                }
            }
            FormField::IsNewTabWorking => FormField::IsInteresting,
            FormField::IsInteresting => FormField::OverallWorking,
            FormField::OverallWorking => FormField::Notes,
            FormField::Notes => FormField::Submit,
            FormField::Submit => {
                if !self.listeners.is_empty() {
                    FormField::Listener(0)
                } else {
                    FormField::Installs
                }
            }
        };
    }

    /// Navigate to previous field
    pub fn prev_field(&mut self) {
        self.active_field = match self.active_field {
            FormField::Listener(idx) => {
                if idx > 0 {
                    FormField::Listener(idx - 1)
                } else {
                    FormField::Submit
                }
            }
            FormField::Installs => {
                if !self.listeners.is_empty() {
                    FormField::Listener(self.listeners.len() - 1)
                } else {
                    FormField::Submit
                }
            }
            FormField::WorksInMv2 => FormField::Installs,
            FormField::NeedsLogin => FormField::WorksInMv2,
            FormField::IsPopupWorking => FormField::NeedsLogin,
            FormField::IsSettingsWorking => {
                if self.has_popup {
                    FormField::IsPopupWorking
                } else {
                    FormField::NeedsLogin
                }
            }
            FormField::IsNewTabWorking => {
                if self.has_settings {
                    FormField::IsSettingsWorking
                } else if self.has_popup {
                    FormField::IsPopupWorking
                } else {
                    FormField::NeedsLogin
                }
            }
            FormField::IsInteresting => {
                if self.is_new_tab_extension {
                    FormField::IsNewTabWorking
                } else if self.has_settings {
                    FormField::IsSettingsWorking
                } else if self.has_popup {
                    FormField::IsPopupWorking
                } else {
                    FormField::NeedsLogin
                }
            }
            FormField::OverallWorking => FormField::IsInteresting,
            FormField::Notes => FormField::OverallWorking,
            FormField::Submit => FormField::Notes,
        };
    }

    /// Toggle listener status (cycle through untested -> yes -> no -> untested)
    pub fn toggle_listener_status(&mut self, idx: usize) {
        if let Some(listener) = self.listeners.get_mut(idx) {
            listener.status = listener.status.cycle();
        }
    }

    /// Set listener status directly (for keyboard shortcuts)
    pub fn set_listener_status(&mut self, idx: usize, status: ListenerStatus) {
        if let Some(listener) = self.listeners.get_mut(idx) {
            listener.status = status;
        }
    }

    /// Toggle installs
    pub fn toggle_installs(&mut self) {
        self.installs = !self.installs;
        self.update_dependent_fields();
    }

    /// Toggle works in MV2
    pub fn toggle_works_in_mv2(&mut self) {
        self.works_in_mv2 = !self.works_in_mv2;
        self.update_dependent_fields();
    }

    /// Toggle needs login
    pub fn toggle_needs_login(&mut self) {
        self.needs_login = !self.needs_login;
        self.update_dependent_fields();
    }

    /// Toggle is popup working
    pub fn toggle_is_popup_working(&mut self) {
        self.is_popup_working = !self.is_popup_working;
        self.update_dependent_fields();
    }

    /// Toggle is settings working
    pub fn toggle_is_settings_working(&mut self) {
        self.is_settings_working = !self.is_settings_working;
        self.update_dependent_fields();
    }

    /// Toggle is new tab working
    pub fn toggle_is_new_tab_working(&mut self) {
        self.is_new_tab_working = !self.is_new_tab_working;
        self.update_dependent_fields();
    }

    /// Update dependent fields based on current values
    /// Rules:
    /// - If needs_login is true -> overall_working should be CouldNotTest
    /// - If works_in_mv2 is false -> overall_working should be CouldNotTest
    /// - If installs is false -> overall_working should be No
    /// - If is_popup_working is false -> overall_working should be No
    /// - If is_settings_working is false -> overall_working should be No
    /// - If is_new_tab_working is false -> overall_working should be No
    pub fn update_dependent_fields(&mut self) {
        // If extension doesn't install, it definitely doesn't work
        if !self.installs {
            self.overall_working = WorkingStatus::No;
        }
        // If it needs login, we can't test it properly
        else if self.needs_login {
            self.overall_working = WorkingStatus::CouldNotTest;
        }
        // If popup is not working (and extension has popup), it's not working properly
        else if self.has_popup && !self.is_popup_working {
            self.overall_working = WorkingStatus::No;
        }
        // If settings are not working (and extension has settings), it's not working properly
        else if self.has_settings && !self.is_settings_working {
            self.overall_working = WorkingStatus::No;
        }
        // If new tab is not working (and extension is new tab extension), it's not working properly
        else if self.is_new_tab_extension && !self.is_new_tab_working {
            self.overall_working = WorkingStatus::No;
        }
    }

    /// Toggle interesting flag
    pub fn toggle_interesting(&mut self) {
        self.is_interesting = !self.is_interesting;
    }

    /// Toggle overall working (cycle through Yes -> No -> Could not test -> Yes)
    pub fn toggle_overall_working(&mut self) {
        self.overall_working = self.overall_working.cycle();
    }

    /// Add character to notes
    pub fn add_char_to_notes(&mut self, c: char) {
        self.notes.insert(self.notes_cursor_pos, c);
        self.notes_cursor_pos += 1;
    }

    /// Remove character from notes (backspace)
    pub fn remove_char_from_notes(&mut self) {
        if self.notes_cursor_pos > 0 {
            self.notes_cursor_pos -= 1;
            self.notes.remove(self.notes_cursor_pos);
        }
    }

    /// Move cursor left in notes
    pub fn move_cursor_left(&mut self) {
        if self.notes_cursor_pos > 0 {
            self.notes_cursor_pos -= 1;
        }
    }

    /// Move cursor right in notes
    pub fn move_cursor_right(&mut self) {
        if self.notes_cursor_pos < self.notes.len() {
            self.notes_cursor_pos += 1;
        }
    }

    /// Add a custom field (for extensibility)
    pub fn add_custom_field(&mut self, key: String, value: String, field_type: String) {
        self.custom_fields.push(CustomField {
            key,
            value,
            field_type,
        });
    }

    /// Convert form to JSON for server submission
    pub fn to_report_json(&self) -> serde_json::Value {
        let mut json = serde_json::json!({
            "extension_id": self.extension_id,
            "tested": true,
            "verification_duration_secs": self.get_verification_duration(),
            // Quick assessment fields
            "installs": self.installs,
            "works_in_mv2": self.works_in_mv2,
            "needs_login": self.needs_login,
            "is_interesting": self.is_interesting,
            "overall_working": self.overall_working.as_str(),
            "notes": self.notes,
            // Listener details
            "listeners": self.listeners.iter().map(|l| {
                serde_json::json!({
                    "api": l.api,
                    "file": l.file,
                    "line": l.line,
                    "status": l.status.as_str(),
                })
            }).collect::<Vec<_>>(),
        });

        // Add ID and timestamps if editing
        if let Some(ref id) = self.report_id {
            json["id"] = serde_json::json!(id);
        }
        if let Some(created) = self.created_at {
            json["created_at"] = serde_json::json!(created);
        }

        // Add conditional fields only if applicable
        if self.has_popup {
            json["is_popup_working"] = serde_json::json!(self.is_popup_working);
        }
        if self.has_settings {
            json["is_settings_working"] = serde_json::json!(self.is_settings_working);
        }
        if self.is_new_tab_extension {
            json["is_new_tab_working"] = serde_json::json!(self.is_new_tab_working);
        }

        // Add custom fields
        for field in &self.custom_fields {
            json[&field.key] = serde_json::json!(field.value);
        }

        json
    }

    /// Validate form before submission
    pub fn validate(&self) -> Result<(), String> {
        // Very lenient validation - form is designed to be quick
        // No strict requirements, just warnings
        Ok(())
    }

    /// Cancel form and reset
    pub fn cancel(&mut self) {
        self.visible = false;
        self.verification_duration_secs = None;
        self.verification_start_time = None;
    }

    /// Render the form
    pub fn render(&self, f: &mut Frame, area: Rect, state: &AppState) {
        let chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Length(6), // Auto-collected data
                Constraint::Min(0),    // Listeners + quick assessment
                Constraint::Length(5), // Notes
                Constraint::Length(3), // Buttons
            ])
            .split(area);

        // Auto-collected data section
        self.render_auto_section(f, chunks[0], state);

        // Manual data section (listeners + quick assessment)
        self.render_manual_section(f, chunks[1], state);

        // Notes section
        self.render_notes_section(f, chunks[2], state);

        // Buttons
        self.render_buttons(f, chunks[3], state);
    }

    fn render_auto_section(&self, f: &mut Frame, area: Rect, state: &AppState) {
        let duration_str = if let Some(duration) = self.get_verification_duration() {
            format!("{:.1}s", duration)
        } else {
            "Not started".to_string()
        };

        let lines = vec![
            Line::from(vec![
                Span::styled("Extension: ", Style::default().add_modifier(Modifier::BOLD)),
                Span::raw(&self.extension_name),
            ]),
            Line::from(vec![
                Span::styled("MV2 ID: ", Style::default().add_modifier(Modifier::BOLD)),
                Span::raw(self.mv2_id.as_deref().unwrap_or("N/A")),
            ]),
            Line::from(vec![
                Span::styled("MV3 ID: ", Style::default().add_modifier(Modifier::BOLD)),
                Span::raw(self.mv3_id.as_deref().unwrap_or("N/A")),
            ]),
            Line::from(vec![
                Span::styled(
                    "Verification Time: ",
                    Style::default().add_modifier(Modifier::BOLD),
                ),
                Span::raw(&duration_str),
            ]),
        ];

        let block = Paragraph::new(lines).block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(Style::default().fg(state.theme.menubar_border))
                .title("Auto-Collected Data"),
        );

        f.render_widget(block, area);
    }

    fn render_manual_section(&self, f: &mut Frame, area: Rect, state: &AppState) {
        // Build constraints dynamically based on which fields are applicable
        let mut constraints = vec![
            Constraint::Min(0),    // Listeners
            Constraint::Length(3), // Installs
            Constraint::Length(3), // Works in MV2
            Constraint::Length(3), // Needs Login
        ];

        // Add conditional fields
        if self.has_popup {
            constraints.push(Constraint::Length(3)); // Is Popup Working
        }
        if self.has_settings {
            constraints.push(Constraint::Length(3)); // Is Settings Working
        }
        if self.is_new_tab_extension {
            constraints.push(Constraint::Length(3)); // Is New Tab Working
        }

        constraints.push(Constraint::Length(3)); // Is Interesting
        constraints.push(Constraint::Length(3)); // Overall Working

        let chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints(constraints)
            .split(area);

        let mut chunk_idx = 0;
        self.render_listeners(f, chunks[chunk_idx], state);
        chunk_idx += 1;

        self.render_toggle_field(
            f,
            chunks[chunk_idx],
            state,
            FormField::Installs,
            "Installs",
            self.installs,
        );
        chunk_idx += 1;

        self.render_toggle_field(
            f,
            chunks[chunk_idx],
            state,
            FormField::WorksInMv2,
            "Works in MV2",
            self.works_in_mv2,
        );
        chunk_idx += 1;

        self.render_toggle_field(
            f,
            chunks[chunk_idx],
            state,
            FormField::NeedsLogin,
            "Needs Login",
            self.needs_login,
        );
        chunk_idx += 1;

        if self.has_popup {
            self.render_toggle_field(
                f,
                chunks[chunk_idx],
                state,
                FormField::IsPopupWorking,
                "Is Popup Working",
                self.is_popup_working,
            );
            chunk_idx += 1;
        }

        if self.has_settings {
            self.render_toggle_field(
                f,
                chunks[chunk_idx],
                state,
                FormField::IsSettingsWorking,
                "Is Settings Working",
                self.is_settings_working,
            );
            chunk_idx += 1;
        }

        if self.is_new_tab_extension {
            self.render_toggle_field(
                f,
                chunks[chunk_idx],
                state,
                FormField::IsNewTabWorking,
                "Is New Tab Working",
                self.is_new_tab_working,
            );
            chunk_idx += 1;
        }

        self.render_toggle_field(
            f,
            chunks[chunk_idx],
            state,
            FormField::IsInteresting,
            "Is Interesting",
            self.is_interesting,
        );
        chunk_idx += 1;

        self.render_tristate_field(
            f,
            chunks[chunk_idx],
            state,
            FormField::OverallWorking,
            "Overall Working",
            self.overall_working,
        );
    }

    fn render_listeners(&self, f: &mut Frame, area: Rect, state: &AppState) {
        let items: Vec<ListItem> = if self.listeners.is_empty() {
            vec![ListItem::new(Line::from(Span::styled(
                "No event listeners found",
                Style::default()
                    .fg(state.theme.text_muted)
                    .add_modifier(Modifier::DIM),
            )))]
        } else {
            self.listeners
                .iter()
                .enumerate()
                .flat_map(|(idx, listener)| {
                    let is_active = self.active_field == FormField::Listener(idx);

                    // First line: Listener name
                    let name_style = if is_active {
                        Style::default()
                            .bg(state.theme.item_selected_bg)
                            .add_modifier(Modifier::BOLD)
                    } else {
                        Style::default()
                    };

                    let prefix = if is_active { "▶ " } else { "  " };

                    let human_label = get_listener_label(&listener.api);

                    let name_line = ListItem::new(Line::from(vec![
                        Span::styled(prefix, name_style),
                        Span::styled(
                            human_label,
                            name_style.fg(state.theme.analyzer_listener_api),
                        ),
                        Span::raw(" "),
                        Span::styled(
                            format!("({})", listener.file),
                            name_style.fg(state.theme.analyzer_listener_file),
                        ),
                    ]));

                    // Second line: Multiple choice options
                    let (y_char, n_char, u_char) = match listener.status {
                        ListenerStatus::Working => ("●", "○", "○"),
                        ListenerStatus::NotWorking => ("○", "●", "○"),
                        ListenerStatus::Untested => ("○", "○", "●"),
                    };

                    let mut choices_line_spans = vec![Span::raw("    ")];

                    // Y: Works option
                    choices_line_spans.push(Span::styled(
                        format!("({}) Y: Works", y_char),
                        Style::default().fg(if listener.status == ListenerStatus::Working {
                            state.theme.status_running
                        } else {
                            state.theme.text_muted
                        }),
                    ));
                    choices_line_spans.push(Span::raw("    "));

                    // N: Doesn't Work option
                    choices_line_spans.push(Span::styled(
                        format!("({}) N: Doesn't Work", n_char),
                        Style::default().fg(if listener.status == ListenerStatus::NotWorking {
                            state.theme.status_stopped
                        } else {
                            state.theme.text_muted
                        }),
                    ));
                    choices_line_spans.push(Span::raw("    "));

                    // ?: Untested option
                    choices_line_spans.push(Span::styled(
                        format!("({}) ?: Untested", u_char),
                        Style::default().fg(state.theme.text_muted),
                    ));

                    let choices_line = ListItem::new(Line::from(choices_line_spans));

                    vec![name_line, choices_line]
                })
                .collect()
        };

        let list = List::new(items).block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(Style::default().fg(state.theme.analyzer_listeners_border))
                .title("Event Listeners (Y: Works • N: Doesn't Work • ?: Untested • Space: Cycle)"),
        );

        f.render_widget(list, area);
    }

    fn render_toggle_field(
        &self,
        f: &mut Frame,
        area: Rect,
        state: &AppState,
        field: FormField,
        label: &str,
        value: bool,
    ) {
        let is_active = self.active_field == field;
        let value_str = if value { "Yes" } else { "No" };
        let value_color = if value {
            state.theme.status_running
        } else {
            state.theme.status_stopped
        };

        let style = if is_active {
            Style::default().add_modifier(Modifier::BOLD)
        } else {
            Style::default()
        };

        let border_style = if is_active {
            Style::default()
                .fg(state.theme.search_border_active)
                .add_modifier(Modifier::BOLD)
        } else {
            Style::default().fg(state.theme.menubar_border)
        };

        let line = Line::from(vec![
            Span::styled(format!("{}: ", label), style),
            Span::styled(value_str, style.fg(value_color)),
            Span::styled(" (Space)", style.fg(state.theme.text_muted)),
        ]);

        let block = Paragraph::new(line).block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(border_style),
        );

        f.render_widget(block, area);
    }

    fn render_tristate_field(
        &self,
        f: &mut Frame,
        area: Rect,
        state: &AppState,
        field: FormField,
        label: &str,
        value: WorkingStatus,
    ) {
        let is_active = self.active_field == field;
        let value_str = value.display_str();
        let value_color = match value {
            WorkingStatus::Yes => state.theme.status_running,
            WorkingStatus::No => state.theme.status_stopped,
            WorkingStatus::CouldNotTest => state.theme.msg_warning,
        };

        let style = if is_active {
            Style::default().add_modifier(Modifier::BOLD)
        } else {
            Style::default()
        };

        let border_style = if is_active {
            Style::default()
                .fg(state.theme.search_border_active)
                .add_modifier(Modifier::BOLD)
        } else {
            Style::default().fg(state.theme.menubar_border)
        };

        let line = Line::from(vec![
            Span::styled(format!("{}: ", label), style),
            Span::styled(value_str, style.fg(value_color)),
            Span::styled(" (Space)", style.fg(state.theme.text_muted)),
        ]);

        let block = Paragraph::new(line).block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(border_style),
        );

        f.render_widget(block, area);
    }

    fn render_notes_section(&self, f: &mut Frame, area: Rect, state: &AppState) {
        let is_active = self.active_field == FormField::Notes;

        let border_style = if is_active {
            Style::default()
                .fg(state.theme.search_border_active)
                .add_modifier(Modifier::BOLD)
        } else {
            Style::default().fg(state.theme.menubar_border)
        };

        let notes_text = if self.notes.is_empty() && !is_active {
            Span::styled(
                "(Optional) Any additional notes...",
                Style::default().fg(state.theme.text_muted),
            )
        } else if is_active {
            // Show cursor
            let before = &self.notes[..self.notes_cursor_pos];
            let after = &self.notes[self.notes_cursor_pos..];
            Span::raw(format!("{}█{}", before, after))
        } else {
            Span::raw(&self.notes)
        };

        let block = Paragraph::new(notes_text).wrap(Wrap { trim: false }).block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(border_style)
                .title("Notes (optional)"),
        );

        f.render_widget(block, area);
    }

    fn render_buttons(&self, f: &mut Frame, area: Rect, state: &AppState) {
        // Submit button (centered, takes full width)
        let submit_active = self.active_field == FormField::Submit;
        let submit_style = if submit_active {
            Style::default()
                .bg(state.theme.status_running)
                .fg(ratatui::style::Color::Black)
                .add_modifier(Modifier::BOLD)
        } else {
            Style::default().fg(state.theme.status_running)
        };

        let submit_block = Paragraph::new(Line::from(vec![Span::styled(
            if submit_active {
                "▶ Submit (Enter)"
            } else {
                "  Submit (Enter)"
            },
            submit_style,
        )]))
        .block(Block::default().borders(Borders::ALL))
        .alignment(ratatui::layout::Alignment::Center);

        f.render_widget(submit_block, area);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{EventListener, Extension};

    fn create_test_extension() -> Extension {
        Extension {
            _id: None,
            id: Some("test123".to_string()),
            name: "Test Extension".to_string(),
            manifest_v2_path: None,
            version: Some("1.0.0".to_string()),
            mv2_extension_id: Some("mv2-id".to_string()),
            mv3_extension_id: Some("mv3-id".to_string()),
            tags: vec![],
            interestingness: Some(75.0),
            migration_time_seconds: None,
            input_path: None,
            manifest_v3_path: None,
            cws_info: None,
            llm_description: None,
            showing_llm_description: false,
            event_listeners: vec![
                EventListener {
                    api: "chrome.tabs.onUpdated".to_string(),
                    file: "background.js".to_string(),
                    line: Some(42),
                    code_snippet: None,
                },
                EventListener {
                    api: "chrome.runtime.onMessage".to_string(),
                    file: "background.js".to_string(),
                    line: Some(84),
                    code_snippet: None,
                },
            ],
            manifest: None,
            files: None,
            is_new_tab_extension: None,
            interestingness_breakdown: None,
            fakeium_validation: None,
        }
    }

    #[test]
    fn test_form_creation() {
        let ext = create_test_extension();
        let form = ReportForm::new(&ext);

        assert_eq!(form.extension_name, "Test Extension");
        assert_eq!(form.mv2_id, Some("mv2-id".to_string()));
        assert_eq!(form.mv3_id, Some("mv3-id".to_string()));
        assert_eq!(form.listeners.len(), 2);
        assert!(form.installs);
        assert!(form.works_in_mv2);
        assert!(!form.needs_login);
        assert!(!form.is_interesting);
        assert_eq!(form.overall_working, WorkingStatus::Yes);
        assert_eq!(form.notes, "");
    }

    #[test]
    fn test_listener_status_cycle() {
        let status = ListenerStatus::Untested;
        assert_eq!(status.cycle(), ListenerStatus::Working);
        assert_eq!(status.cycle().cycle(), ListenerStatus::NotWorking);
        assert_eq!(status.cycle().cycle().cycle(), ListenerStatus::Untested);
    }

    #[test]
    fn test_working_status_cycle() {
        let status = WorkingStatus::Yes;
        assert_eq!(status.cycle(), WorkingStatus::No);
        assert_eq!(status.cycle().cycle(), WorkingStatus::CouldNotTest);
        assert_eq!(status.cycle().cycle().cycle(), WorkingStatus::Yes);
    }

    #[test]
    fn test_field_navigation() {
        let ext = create_test_extension();
        let mut form = ReportForm::new(&ext);

        assert_eq!(form.active_field, FormField::Listener(0));
        form.next_field();
        assert_eq!(form.active_field, FormField::Listener(1));
        form.next_field();
        assert_eq!(form.active_field, FormField::Installs);
        form.next_field();
        assert_eq!(form.active_field, FormField::WorksInMv2);
        form.next_field();
        assert_eq!(form.active_field, FormField::NeedsLogin);
        form.next_field();
        assert_eq!(form.active_field, FormField::IsInteresting);
    }

    #[test]
    fn test_json_serialization() {
        let ext = create_test_extension();
        let mut form = ReportForm::new(&ext);
        form.installs = false;
        form.works_in_mv2 = false;
        form.overall_working = WorkingStatus::No;
        form.needs_login = true;
        form.is_interesting = true;
        form.notes = "Test notes".to_string();
        form.toggle_listener_status(0);

        let json = form.to_report_json();
        assert_eq!(json["extension_id"], "test123");
        assert_eq!(json["tested"], true);
        assert_eq!(json["installs"], false);
        assert_eq!(json["works_in_mv2"], false);
        assert_eq!(json["overall_working"], "no");
        assert_eq!(json["needs_login"], true);
        assert_eq!(json["is_interesting"], true);
        assert_eq!(json["notes"], "Test notes");
        assert_eq!(json["listeners"][0]["status"], "yes");
    }
}
