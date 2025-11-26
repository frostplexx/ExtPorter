use anyhow::Result;
use ratatui::crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use tokio::sync::mpsc;

use crate::{app::AppState, types::AppEvent};

use super::report_form::{FormField, ReportForm};

pub fn handle_comparison_input(
    key: KeyEvent,
    state: &mut AppState,
    tx: mpsc::UnboundedSender<AppEvent>,
    mv2_browser_running: &mut bool,
    mv3_browser_running: &mut bool,
    report_form: &mut Option<ReportForm>,
) -> Result<()> {
    // Check if form is visible
    let form_visible = report_form.as_ref().map_or(false, |f| f.visible);

    if form_visible {
        // Form mode input handling
        handle_form_input(key, state, tx, report_form)
    } else {
        // Normal mode input handling
        handle_normal_input(
            key,
            state,
            tx,
            mv2_browser_running,
            mv3_browser_running,
            report_form,
        )
    }
}

fn handle_normal_input(
    key: KeyEvent,
    state: &mut AppState,
    tx: mpsc::UnboundedSender<AppEvent>,
    mv2_browser_running: &mut bool,
    mv3_browser_running: &mut bool,
    report_form: &mut Option<ReportForm>,
) -> Result<()> {
    match key.code {
        KeyCode::Enter => {
            // Start testing: Open browsers and show form
            if let Some(ref ext_id) = state.selected_extension_id {
                if let Some(ext) = state.extensions.iter().find(|e| e.get_id() == *ext_id) {
                    // Launch browsers
                    let msg = format!("LAUNCH_DUAL:{}", ext_id);
                    let _ = tx.send(AppEvent::SendWebSocketMessage(msg));
                    *mv2_browser_running = true;
                    *mv3_browser_running = true;

                    // Initialize and show form
                    let mut form = ReportForm::new(ext);
                    form.start_verification();
                    *report_form = Some(form);
                }
            }
        }
        KeyCode::Char('o') | KeyCode::Char('O') => {
            // Launch both browsers (without form)
            if let Some(ref ext_id) = state.selected_extension_id {
                if let Some(_ext) = state.extensions.iter().find(|e| e.get_id() == *ext_id) {
                    let msg = format!("LAUNCH_DUAL:{}", ext_id);
                    let _ = tx.send(AppEvent::SendWebSocketMessage(msg));
                    *mv2_browser_running = true;
                    *mv3_browser_running = true;
                }
            }
        }
        KeyCode::Char('q') | KeyCode::Char('Q') => {
            // Close both browsers
            *mv2_browser_running = false;
            *mv3_browser_running = false;
            let _ = tx.send(AppEvent::SendWebSocketMessage("CLOSE_BROWSERS".to_string()));
        }
        KeyCode::Char('n') | KeyCode::Char('N') => {
            // Load next untested extension
            let _ = tx.send(AppEvent::LoadNextUntestedExtension);
        }
        KeyCode::Char('p') | KeyCode::Char('P') => {
            // Load previous untested extension
            let _ = tx.send(AppEvent::LoadPreviousUntestedExtension);
        }
        _ => {}
    }
    Ok(())
}

fn handle_form_input(
    key: KeyEvent,
    state: &mut AppState,
    tx: mpsc::UnboundedSender<AppEvent>,
    report_form: &mut Option<ReportForm>,
) -> Result<()> {
    if let Some(form) = report_form {
        match key.code {
            KeyCode::Tab => {
                if key.modifiers.contains(KeyModifiers::SHIFT) {
                    form.prev_field();
                } else {
                    form.next_field();
                }
            }
            KeyCode::BackTab => {
                // Many terminals send BackTab for Shift+Tab
                form.prev_field();
            }
            KeyCode::Esc => {
                // Cancel form - close browsers
                let _ = tx.send(AppEvent::SendWebSocketMessage("CLOSE_BROWSERS".to_string()));
                form.cancel();
                *report_form = None;
            }
            KeyCode::Enter => {
                // Handle Submit and Cancel buttons
                if form.active_field == FormField::Submit {
                    // Submit the form
                    submit_report(form, state, tx)?;
                    *report_form = None;
                } else if form.active_field == FormField::Cancel {
                    // Cancel the form - close browsers
                    let _ = tx.send(AppEvent::SendWebSocketMessage("CLOSE_BROWSERS".to_string()));
                    form.cancel();
                    *report_form = None;
                } else {
                    // Move to next field for other fields
                    form.next_field();
                }
            }
            KeyCode::Char(' ') => {
                // Notes field: add space to text
                if form.active_field == FormField::Notes {
                    form.add_char_to_notes(' ');
                } else {
                    // Toggle current field
                    match form.active_field {
                        FormField::Listener(idx) => {
                            form.toggle_listener_status(idx);
                        }
                        FormField::OverallWorking => {
                            form.toggle_overall_working();
                        }
                        FormField::HasErrors => {
                            form.toggle_has_errors();
                        }
                        FormField::SeemsSlower => {
                            form.toggle_seems_slower();
                        }
                        FormField::NeedsLogin => {
                            form.toggle_needs_login();
                        }
                        FormField::IsPopupBroken => {
                            form.toggle_is_popup_broken();
                        }
                        FormField::IsSettingsBroken => {
                            form.toggle_is_settings_broken();
                        }
                        FormField::IsInteresting => {
                            form.toggle_interesting();
                        }
                        _ => {}
                    }
                }
            }
            KeyCode::Char(c) => {
                // Handle listener shortcuts when a listener is focused
                if let FormField::Listener(idx) = form.active_field {
                    match c {
                        'y' | 'Y' => {
                            form.set_listener_status(
                                idx,
                                super::report_form::ListenerStatus::Working,
                            );
                        }
                        'n' | 'N' => {
                            form.set_listener_status(
                                idx,
                                super::report_form::ListenerStatus::NotWorking,
                            );
                        }
                        'u' | 'U' | '?' => {
                            form.set_listener_status(
                                idx,
                                super::report_form::ListenerStatus::Untested,
                            );
                        }
                        _ => {}
                    }
                } else if form.active_field == FormField::Notes {
                    // Only add characters to notes field
                    form.add_char_to_notes(c);
                }
            }
            KeyCode::Backspace => {
                if form.active_field == FormField::Notes {
                    form.remove_char_from_notes();
                }
            }
            KeyCode::Left => {
                if form.active_field == FormField::Notes {
                    form.move_cursor_left();
                }
            }
            KeyCode::Right => {
                if form.active_field == FormField::Notes {
                    form.move_cursor_right();
                }
            }
            _ => {}
        }
    }
    Ok(())
}

fn submit_report(
    form: &mut ReportForm,
    state: &mut AppState,
    tx: mpsc::UnboundedSender<AppEvent>,
) -> Result<()> {
    // Stop verification timer
    form.stop_verification();

    // Validate form
    if let Err(err) = form.validate() {
        // TODO: Show error message to user
        eprintln!("Form validation failed: {}", err);
        return Ok(());
    }

    // Convert to JSON
    let report_json = form.to_report_json();

    // Send to server
    let create_report_msg = format!(
        r#"{{"type":"db_query","id":"create_report","method":"createReport","params":{}}}"#,
        serde_json::to_string(&report_json)?
    );
    let _ = tx.send(AppEvent::SendWebSocketMessage(create_report_msg));

    // Fetch updated reports list
    let get_reports_msg =
        r#"{"type":"db_query","id":"get_reports","method":"getAllReports","params":{}}"#;
    let _ = tx.send(AppEvent::SendWebSocketMessage(get_reports_msg.to_string()));

    // Close browsers
    let _ = tx.send(AppEvent::SendWebSocketMessage("CLOSE_BROWSERS".to_string()));

    // Load next untested extension
    let _ = tx.send(AppEvent::LoadNextUntestedExtension);

    // Add system message
    if state.message_scroll_offset > 0 {
        state.message_scroll_offset += 1;
    }
    state.messages.push(crate::types::Message {
        msg_type: crate::types::MessageType::System,
        content: "✓ Report submitted successfully".to_string(),
        timestamp: chrono::Utc::now(),
    });

    Ok(())
}
