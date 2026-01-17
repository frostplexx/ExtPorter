use anyhow::Result;
use ratatui::crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use tokio::sync::mpsc;

use crate::{
    app::AppState,
    types::{AppEvent, Extension, ListenerTestResult, Report},
};

use super::report_form::{FormField, ReportForm};

pub fn handle_comparison_input(
    key: KeyEvent,
    state: &mut AppState,
    tx: mpsc::UnboundedSender<AppEvent>,
    mv2_browser_running: &mut bool,
    mv3_browser_running: &mut bool,
    report_form: &mut Option<ReportForm>,
    listeners_scroll_offset: &mut usize,
    pending_form_extension: &mut Option<Extension>,
) -> Result<()> {
    // Check if form is visible
    let form_visible = report_form.as_ref().map_or(false, |f| f.visible);

    if form_visible {
        // Form mode input handling
        handle_form_input(key, state, tx, report_form, listeners_scroll_offset)
    } else {
        // Normal mode input handling
        handle_normal_input(
            key,
            state,
            tx,
            mv2_browser_running,
            mv3_browser_running,
            report_form,
            listeners_scroll_offset,
            pending_form_extension,
        )
    }
}

fn handle_normal_input(
    key: KeyEvent,
    state: &mut AppState,
    tx: mpsc::UnboundedSender<AppEvent>,
    mv2_browser_running: &mut bool,
    mv3_browser_running: &mut bool,
    _report_form: &mut Option<ReportForm>,
    listeners_scroll_offset: &mut usize,
    pending_form_extension: &mut Option<Extension>,
) -> Result<()> {
    match key.code {
        KeyCode::Enter => {
            // Start testing: Download extension locally, then launch browsers
            // Form will be shown when BrowserLaunched event fires
            if let Some(ref ext_id) = state.selected_extension_id {
                if let Some(ext) = state.extensions.iter().find(|e| e.get_id() == *ext_id) {
                    // Request extension download (will trigger browser launch after download)
                    let _ = tx.send(AppEvent::DownloadExtension(ext_id.clone()));
                    *mv2_browser_running = true;
                    *mv3_browser_running = true;

                    // Store the extension for form display AFTER browser launches
                    // Do NOT show form immediately - wait for BrowserLaunched event
                    *pending_form_extension = Some(ext.clone());
                }
            }
        }
        KeyCode::Char('o') | KeyCode::Char('O') => {
            // Launch both browsers (without form) - download and launch
            if let Some(ref ext_id) = state.selected_extension_id {
                if let Some(_ext) = state.extensions.iter().find(|e| e.get_id() == *ext_id) {
                    let _ = tx.send(AppEvent::DownloadExtension(ext_id.clone()));
                    *mv2_browser_running = true;
                    *mv3_browser_running = true;
                }
            }
        }
        KeyCode::Char('q') | KeyCode::Char('Q') => {
            // Close both browsers
            *mv2_browser_running = false;
            *mv3_browser_running = false;
            let _ = tx.send(AppEvent::CloseBrowsersCmd);
        }
        KeyCode::Char('k') | KeyCode::Char('K') => {
            // Open extension folders in kitty tab (side-by-side)
            if let Some((mv2_path, mv3_path)) = state.current_extension_paths.clone() {
                let _ = tx.send(AppEvent::OpenKittyTab(mv2_path, mv3_path));
            } else {
                // No extension downloaded yet - show message
                state.messages.push(crate::types::Message {
                    msg_type: crate::types::MessageType::System,
                    content: "No extension downloaded yet. Press Enter to download first."
                        .to_string(),
                    timestamp: chrono::Utc::now(),
                });
            }
        }
        KeyCode::Char('n') | KeyCode::Char('N') => {
            // Load next untested extension
            let _ = tx.send(AppEvent::LoadNextUntestedExtension);
        }
        KeyCode::Char('b') | KeyCode::Char('B') => {
            // Load previous untested extension (Back)
            let _ = tx.send(AppEvent::LoadPreviousUntestedExtension);
        }
        KeyCode::Char('d') | KeyCode::Char('D') => {
            // Toggle between LLM and CWS description
            if let Some(ref ext_id) = state.selected_extension_id {
                if let Some(ext) = state.extensions.iter_mut().find(|e| e.get_id() == *ext_id) {
                    // Only toggle if LLM description is available
                    if ext.llm_description.is_some() || ext.cws_info.is_some() {
                        ext.showing_llm_description = !ext.showing_llm_description;
                    }
                }
            }
        }
        KeyCode::Char('f') | KeyCode::Char('F') => {
            // Trigger LLM fix for current extension
            if let Some(ref ext_id) = state.selected_extension_id {
                // Send fix request
                let msg = format!("FIX_EXTENSION:{}", ext_id);
                let _ = tx.send(AppEvent::SendWebSocketMessage(msg));
                let _ = tx.send(AppEvent::LLMFixStarted(ext_id.clone()));
            }
        }
        KeyCode::Char('j') | KeyCode::Char('J') | KeyCode::Down => {
            // Scroll listeners panel down
            *listeners_scroll_offset = listeners_scroll_offset.saturating_add(1);
        }
        KeyCode::Up => {
            // Scroll listeners panel up (only Up arrow, not k/K which is now kitty)
            *listeners_scroll_offset = listeners_scroll_offset.saturating_sub(1);
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
    listeners_scroll_offset: &mut usize,
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
                let _ = tx.send(AppEvent::CloseBrowsersCmd);
                form.cancel();
                *report_form = None;
            }
            KeyCode::Enter => {
                // Enter on Submit button submits the form
                if form.active_field == FormField::Submit {
                    submit_report(form, state, tx)?;
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
                    let should_advance = match form.active_field {
                        FormField::Listener(idx) => {
                            form.toggle_listener_status(idx);
                            true // Auto-advance after toggling listener
                        }
                        FormField::Installs => {
                            form.toggle_installs();
                            false
                        }
                        FormField::WorksInMv2 => {
                            form.toggle_works_in_mv2();
                            false
                        }
                        FormField::NeedsLogin => {
                            form.toggle_needs_login();
                            false
                        }
                        FormField::IsPopupWorking => {
                            form.toggle_is_popup_working();
                            false
                        }
                        FormField::IsSettingsWorking => {
                            form.toggle_is_settings_working();
                            false
                        }
                        FormField::IsNewTabWorking => {
                            form.toggle_is_new_tab_working();
                            false
                        }
                        FormField::IsInteresting => {
                            form.toggle_interesting();
                            false
                        }
                        FormField::OverallWorking => {
                            form.toggle_overall_working();
                            false
                        }
                        _ => false,
                    };

                    // Auto-advance to next field if it was a listener
                    if should_advance {
                        form.next_field();
                    }
                }
            }
            KeyCode::Char(c) => {
                // Handle 'D' key globally (not just in notes field) for description toggle
                if (c == 'd' || c == 'D') && form.active_field != FormField::Notes {
                    // Toggle between LLM and CWS description
                    if let Some(ref ext_id) = state.selected_extension_id {
                        if let Some(ext) =
                            state.extensions.iter_mut().find(|e| e.get_id() == *ext_id)
                        {
                            // Only toggle if LLM description is available
                            if ext.llm_description.is_some() || ext.cws_info.is_some() {
                                ext.showing_llm_description = !ext.showing_llm_description;
                            }
                        }
                    }
                    return Ok(());
                }

                // Handle 'S' key globally (not just in notes field) for quick submit
                if (c == 's' || c == 'S') && form.active_field != FormField::Notes {
                    submit_report(form, state, tx)?;
                    *report_form = None;
                    return Ok(());
                }

                // Handle listener shortcuts when a listener is focused
                if let FormField::Listener(idx) = form.active_field {
                    let should_advance = match c {
                        'y' | 'Y' => {
                            form.set_listener_status(
                                idx,
                                super::report_form::ListenerStatus::Working,
                            );
                            true
                        }
                        'n' | 'N' => {
                            form.set_listener_status(
                                idx,
                                super::report_form::ListenerStatus::NotWorking,
                            );
                            true
                        }
                        'u' | 'U' | '?' => {
                            form.set_listener_status(
                                idx,
                                super::report_form::ListenerStatus::Untested,
                            );
                            true
                        }
                        _ => false,
                    };

                    // Auto-advance to next listener if status was set
                    if should_advance {
                        form.next_field();
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
            KeyCode::Down => {
                // Scroll listeners panel down (only if not in Notes field)
                if form.active_field != FormField::Notes {
                    *listeners_scroll_offset = listeners_scroll_offset.saturating_add(1);
                }
            }
            KeyCode::Up => {
                // Scroll listeners panel up (only if not in Notes field)
                if form.active_field != FormField::Notes {
                    *listeners_scroll_offset = listeners_scroll_offset.saturating_sub(1);
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

    // Send to server (create or update based on edit mode)
    let message = if form.is_editing {
        format!(
            r#"{{"type":"db_query","id":"update_report","method":"updateReport","params":{}}}"#,
            serde_json::to_string(&report_json)?
        )
    } else {
        format!(
            r#"{{"type":"db_query","id":"create_report","method":"createReport","params":{}}}"#,
            serde_json::to_string(&report_json)?
        )
    };
    let _ = tx.send(AppEvent::SendWebSocketMessage(message));

    // Create local report to update state immediately (optimistic update)
    // This ensures the extension is marked as tested without waiting for server sync
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0);

    let local_report = Report {
        id: form
            .report_id
            .clone()
            .unwrap_or_else(|| format!("local_{}", form.extension_id)),
        extension_id: form.extension_id.clone(),
        tested: true,
        created_at: form.created_at.unwrap_or(now),
        updated_at: now,
        verification_duration_secs: form.get_verification_duration(),
        installs: Some(form.installs),
        works_in_mv2: Some(form.works_in_mv2),
        overall_working: Some(form.overall_working.as_str().to_string()),
        has_errors: None,
        seems_slower: None,
        needs_login: Some(form.needs_login),
        is_popup_working: if form.has_popup {
            Some(form.is_popup_working)
        } else {
            None
        },
        is_settings_working: if form.has_settings {
            Some(form.is_settings_working)
        } else {
            None
        },
        is_new_tab_working: if form.is_new_tab_extension {
            Some(form.is_new_tab_working)
        } else {
            None
        },
        is_interesting: Some(form.is_interesting),
        notes: if form.notes.is_empty() {
            None
        } else {
            Some(form.notes.clone())
        },
        listeners: form
            .listeners
            .iter()
            .map(|l| ListenerTestResult {
                api: l.api.clone(),
                file: l.file.clone(),
                line: l.line,
                status: l.status.as_str().to_string(),
            })
            .collect(),
    };

    // Update local state: remove old report for this extension (if any) and add new one
    state
        .reports
        .retain(|r| r.extension_id != form.extension_id);
    state.reports.push(local_report);

    // Close browsers
    let _ = tx.send(AppEvent::CloseBrowsersCmd);

    // Load next untested extension (only if creating new report, not editing)
    // NOTE: We do this BEFORE requesting a server sync to avoid race conditions
    // where the server response replaces our local state before navigation happens
    if !form.is_editing {
        let _ = tx.send(AppEvent::LoadNextUntestedExtension);
    }

    // Request updated reports list from server (will sync with server state eventually)
    // This happens AFTER navigation to avoid the server response overwriting our local
    // optimistic update before we've had a chance to navigate
    let get_reports_msg =
        r#"{"type":"db_query","id":"get_reports","method":"getAllReports","params":{}}"#;
    let _ = tx.send(AppEvent::SendWebSocketMessage(get_reports_msg.to_string()));

    // Add system message
    if state.message_scroll_offset > 0 {
        state.message_scroll_offset += 1;
    }
    let success_msg = if form.is_editing {
        "✓ Report updated successfully"
    } else {
        "✓ Report submitted successfully"
    };
    state.messages.push(crate::types::Message {
        msg_type: crate::types::MessageType::System,
        content: success_msg.to_string(),
        timestamp: chrono::Utc::now(),
    });

    Ok(())
}
