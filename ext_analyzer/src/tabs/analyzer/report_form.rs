use ratatui::{
    layout::{Constraint, Direction, Layout, Rect},
    style::{Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, List, ListItem, Paragraph, Wrap},
    Frame,
};
use serde::{Deserialize, Serialize};
use std::time::Instant;

use crate::{app::AppState, types::Extension};

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
    Listener(usize),  // Index into listeners vec
    OverallWorking,   // Does it basically work?
    HasErrors,        // Did you see errors?
    SeemsSlower,      // Performance check
    NeedsLogin,       // Does it need login to test?
    IsPopupBroken,    // Is the popup broken? (conditional - only if has popup)
    IsSettingsBroken, // Are the settings broken? (conditional - only if has settings)
    IsInteresting,    // Is this extension interesting for research?
    Notes,            // Freeform text (optional)
    Submit,
    Cancel,
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
    pub overall_working: bool,    // Does it basically work?
    pub has_errors: bool,         // Did you see errors?
    pub seems_slower: bool,       // Noticeably slower?
    pub needs_login: bool,        // Does it need login to test?
    pub is_popup_broken: bool,    // Is the popup broken?
    pub is_settings_broken: bool, // Are the settings broken?
    pub is_interesting: bool,     // Is it interesting for research?
    pub notes: String,            // Optional notes

    // Per-listener testing
    pub listeners: Vec<ListenerTestResult>,

    // Manifest metadata (for conditional fields)
    pub has_popup: bool,
    pub has_settings: bool,

    // Form state
    pub active_field: FormField,
    pub visible: bool,
    pub notes_cursor_pos: usize,

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

        let first_field = if !listeners.is_empty() {
            FormField::Listener(0)
        } else {
            FormField::OverallWorking
        };

        Self {
            extension_name: extension.name.clone(),
            mv2_id: extension.mv2_extension_id.clone(),
            mv3_id: extension.mv3_extension_id.clone(),
            extension_id: extension.get_id(),
            verification_start_time: None,
            verification_duration_secs: None,
            overall_working: true, // Default optimistic
            has_errors: false,
            seems_slower: false,
            needs_login: false,
            is_popup_broken: false,
            is_settings_broken: false,
            is_interesting: false,
            notes: String::new(),
            listeners,
            has_popup,
            has_settings,
            active_field: first_field,
            visible: false,
            notes_cursor_pos: 0,
            custom_fields: Vec::new(),
        }
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
                    FormField::OverallWorking
                }
            }
            FormField::OverallWorking => FormField::HasErrors,
            FormField::HasErrors => FormField::SeemsSlower,
            FormField::SeemsSlower => FormField::NeedsLogin,
            FormField::NeedsLogin => {
                if self.has_popup {
                    FormField::IsPopupBroken
                } else if self.has_settings {
                    FormField::IsSettingsBroken
                } else {
                    FormField::IsInteresting
                }
            }
            FormField::IsPopupBroken => {
                if self.has_settings {
                    FormField::IsSettingsBroken
                } else {
                    FormField::IsInteresting
                }
            }
            FormField::IsSettingsBroken => FormField::IsInteresting,
            FormField::IsInteresting => FormField::Notes,
            FormField::Notes => FormField::Submit,
            FormField::Submit => FormField::Cancel,
            FormField::Cancel => {
                if !self.listeners.is_empty() {
                    FormField::Listener(0)
                } else {
                    FormField::OverallWorking
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
                    FormField::Cancel
                }
            }
            FormField::OverallWorking => {
                if !self.listeners.is_empty() {
                    FormField::Listener(self.listeners.len() - 1)
                } else {
                    FormField::Cancel
                }
            }
            FormField::HasErrors => FormField::OverallWorking,
            FormField::SeemsSlower => FormField::HasErrors,
            FormField::NeedsLogin => FormField::SeemsSlower,
            FormField::IsPopupBroken => FormField::NeedsLogin,
            FormField::IsSettingsBroken => {
                if self.has_popup {
                    FormField::IsPopupBroken
                } else {
                    FormField::NeedsLogin
                }
            }
            FormField::IsInteresting => {
                if self.has_settings {
                    FormField::IsSettingsBroken
                } else if self.has_popup {
                    FormField::IsPopupBroken
                } else {
                    FormField::NeedsLogin
                }
            }
            FormField::Notes => FormField::IsInteresting,
            FormField::Submit => FormField::Notes,
            FormField::Cancel => FormField::Submit,
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

    /// Toggle overall working
    pub fn toggle_overall_working(&mut self) {
        self.overall_working = !self.overall_working;
    }

    /// Toggle has errors
    pub fn toggle_has_errors(&mut self) {
        self.has_errors = !self.has_errors;
    }

    /// Toggle seems slower
    pub fn toggle_seems_slower(&mut self) {
        self.seems_slower = !self.seems_slower;
    }

    /// Toggle needs login
    pub fn toggle_needs_login(&mut self) {
        self.needs_login = !self.needs_login;
    }

    /// Toggle is popup broken
    pub fn toggle_is_popup_broken(&mut self) {
        self.is_popup_broken = !self.is_popup_broken;
    }

    /// Toggle is settings broken
    pub fn toggle_is_settings_broken(&mut self) {
        self.is_settings_broken = !self.is_settings_broken;
    }

    /// Toggle interesting flag
    pub fn toggle_interesting(&mut self) {
        self.is_interesting = !self.is_interesting;
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
            "overall_working": self.overall_working,
            "has_errors": self.has_errors,
            "seems_slower": self.seems_slower,
            "needs_login": self.needs_login,
            "is_interesting": self.is_interesting,
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

        // Add conditional fields only if applicable
        if self.has_popup {
            json["is_popup_broken"] = serde_json::json!(self.is_popup_broken);
        }
        if self.has_settings {
            json["is_settings_broken"] = serde_json::json!(self.is_settings_broken);
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
            Constraint::Length(3), // Overall Working
            Constraint::Length(3), // Has Errors
            Constraint::Length(3), // Seems Slower
            Constraint::Length(3), // Needs Login
        ];

        // Add conditional fields
        if self.has_popup {
            constraints.push(Constraint::Length(3)); // Is Popup Broken
        }
        if self.has_settings {
            constraints.push(Constraint::Length(3)); // Is Settings Broken
        }

        constraints.push(Constraint::Length(3)); // Is Interesting

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
            FormField::OverallWorking,
            "Overall Working",
            self.overall_working,
        );
        chunk_idx += 1;

        self.render_toggle_field(
            f,
            chunks[chunk_idx],
            state,
            FormField::HasErrors,
            "Has Errors",
            self.has_errors,
        );
        chunk_idx += 1;

        self.render_toggle_field(
            f,
            chunks[chunk_idx],
            state,
            FormField::SeemsSlower,
            "Seems Slower",
            self.seems_slower,
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
                FormField::IsPopupBroken,
                "Is Popup Broken",
                self.is_popup_broken,
            );
            chunk_idx += 1;
        }

        if self.has_settings {
            self.render_toggle_field(
                f,
                chunks[chunk_idx],
                state,
                FormField::IsSettingsBroken,
                "Is Settings Broken",
                self.is_settings_broken,
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

                    let name_line = ListItem::new(Line::from(vec![
                        Span::styled(prefix, name_style),
                        Span::styled(
                            &listener.api,
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
            state.theme.text_muted
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
        let button_chunks = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([Constraint::Percentage(50), Constraint::Percentage(50)])
            .split(area);

        // Submit button
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
        .block(Block::default().borders(Borders::ALL));

        // Cancel button
        let cancel_active = self.active_field == FormField::Cancel;
        let cancel_style = if cancel_active {
            Style::default()
                .bg(state.theme.status_stopped)
                .fg(ratatui::style::Color::Black)
                .add_modifier(Modifier::BOLD)
        } else {
            Style::default().fg(state.theme.status_stopped)
        };

        let cancel_block = Paragraph::new(Line::from(vec![Span::styled(
            if cancel_active {
                "▶ Cancel (Esc)"
            } else {
                "  Cancel (Esc)"
            },
            cancel_style,
        )]))
        .block(Block::default().borders(Borders::ALL));

        f.render_widget(submit_block, button_chunks[0]);
        f.render_widget(cancel_block, button_chunks[1]);
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
        assert!(form.overall_working);
        assert!(!form.has_errors);
        assert!(!form.seems_slower);
        assert!(!form.is_interesting);
        assert_eq!(form.confidence, ConfidenceLevel::Medium);
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
    fn test_confidence_cycle() {
        let conf = ConfidenceLevel::Low;
        assert_eq!(conf.cycle(), ConfidenceLevel::Medium);
        assert_eq!(conf.cycle().cycle(), ConfidenceLevel::High);
        assert_eq!(conf.cycle().cycle().cycle(), ConfidenceLevel::Low);
    }

    #[test]
    fn test_field_navigation() {
        let ext = create_test_extension();
        let mut form = ReportForm::new(&ext);

        assert_eq!(form.active_field, FormField::Listener(0));
        form.next_field();
        assert_eq!(form.active_field, FormField::Listener(1));
        form.next_field();
        assert_eq!(form.active_field, FormField::OverallWorking);
        form.next_field();
        assert_eq!(form.active_field, FormField::HasErrors);
    }

    #[test]
    fn test_json_serialization() {
        let ext = create_test_extension();
        let mut form = ReportForm::new(&ext);
        form.overall_working = false;
        form.has_errors = true;
        form.seems_slower = true;
        form.is_interesting = true;
        form.confidence = ConfidenceLevel::High;
        form.notes = "Test notes".to_string();
        form.toggle_listener_status(0);

        let json = form.to_report_json();
        assert_eq!(json["extension_id"], "test123");
        assert_eq!(json["tested"], true);
        assert_eq!(json["overall_working"], false);
        assert_eq!(json["has_errors"], true);
        assert_eq!(json["seems_slower"], true);
        assert_eq!(json["is_interesting"], true);
        assert_eq!(json["confidence"], "high");
        assert_eq!(json["notes"], "Test notes");
        assert_eq!(json["listeners"][0]["status"], "yes");
    }
}
