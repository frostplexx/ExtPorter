use ratatui::{
    layout::{Constraint, Direction, Layout},
    style::{Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Paragraph},
    Frame,
};
use ratatui_image::{protocol::StatefulProtocol, StatefulImage};
use tokio::sync::mpsc;

use crate::{app::AppState, types::AppEvent};

use super::{image_handler::ImageHandler, report_form::ReportForm};

pub fn render_comparison_mode(
    f: &mut Frame,
    area: ratatui::layout::Rect,
    state: &AppState,
    _tx: mpsc::UnboundedSender<AppEvent>,
    mv2_browser_running: bool,
    mv3_browser_running: bool,
    event_count: u32,
    image_handler: &mut ImageHandler,
    last_displayed_ext_id: &mut Option<String>,
    image_protocols: &mut Vec<Option<StatefulProtocol>>,
    report_form: &mut Option<ReportForm>,
) {
    // Get selected extension by ID from AppState
    let selected_ext = if let Some(ref ext_id) = state.selected_extension_id {
        state.extensions.iter().find(|e| e.get_id() == *ext_id)
    } else {
        None
    };

    // Check if form is visible
    let form_visible = report_form.as_ref().map_or(false, |f| f.visible);

    if form_visible {
        // Form mode: Split screen - left side shows form, right side shows listeners and description
        render_form_mode(f, area, state, selected_ext, report_form);
    } else {
        // Normal mode: Show browser cards, extension details, and listeners
        render_normal_mode(
            f,
            area,
            state,
            mv2_browser_running,
            mv3_browser_running,
            event_count,
            image_handler,
            last_displayed_ext_id,
            image_protocols,
            selected_ext,
        );
    }
}

fn render_normal_mode(
    f: &mut Frame,
    area: ratatui::layout::Rect,
    state: &AppState,
    mv2_browser_running: bool,
    mv3_browser_running: bool,
    event_count: u32,
    image_handler: &mut ImageHandler,
    last_displayed_ext_id: &mut Option<String>,
    image_protocols: &mut Vec<Option<StatefulProtocol>>,
    selected_ext: Option<&crate::types::Extension>,
) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Min(0),
            Constraint::Length(3),
            Constraint::Length(1),
        ])
        .split(area);

    // Main area: split into left, center, and right
    let main_chunks = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Percentage(20), // Left: V2/V3 cards
            Constraint::Percentage(50), // Center: Extension details
            Constraint::Percentage(30), // Right: Registered listeners
        ])
        .split(chunks[0]);

    // If extension changed, start downloading its images
    if let Some(ext) = selected_ext {
        let ext_id = ext.get_id();
        if last_displayed_ext_id.as_ref() != Some(&ext_id) {
            *last_displayed_ext_id = Some(ext_id.clone());

            // Reset the image handler's display state for the new extension
            image_handler.reset_for_extension(ext_id.clone());

            // Clear existing protocols and initialize based on number of images
            if let Some(ref cws) = ext.cws_info {
                *image_protocols = (0..cws.images.screenshots.len()).map(|_| None).collect();
            } else {
                image_protocols.clear();
            }

            // Start downloading images if we have CWS info with images
            if let Some(ref cws) = ext.cws_info {
                if !cws.images.screenshots.is_empty() {
                    image_handler.start_downloading(ext_id.clone(), cws.images.screenshots.clone());
                }
            }
        } else {
            // Same extension - check if we can create protocols for downloaded images
            if let Some(ref cws) = ext.cws_info {
                // Ensure we have enough protocol slots
                if image_protocols.len() < cws.images.screenshots.len() {
                    image_protocols.resize_with(cws.images.screenshots.len(), || None);
                }

                // Try to create protocols for all images
                for (i, url) in cws.images.screenshots.iter().enumerate() {
                    if i < image_protocols.len() && image_protocols[i].is_none() {
                        if let Some(protocol) = image_handler.create_protocol(url) {
                            image_protocols[i] = Some(protocol);
                        }
                    }
                }
            }
        }
    }

    render_browser_cards(
        f,
        &main_chunks[0],
        state,
        mv2_browser_running,
        mv3_browser_running,
        event_count,
    );
    render_extension_details(
        f,
        &main_chunks[1],
        state,
        selected_ext,
        image_handler,
        image_protocols,
    );
    render_listeners_panel(f, &main_chunks[2], state, selected_ext);
    render_status_bar(f, &chunks[1], state, selected_ext, event_count);
    render_help_text(f, &chunks[2], state, false);
}

fn render_form_mode(
    f: &mut Frame,
    area: ratatui::layout::Rect,
    state: &AppState,
    selected_ext: Option<&crate::types::Extension>,
    report_form: &mut Option<ReportForm>,
) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Min(0), Constraint::Length(1)])
        .split(area);

    // Main area: split into form (left) and info (right)
    let main_chunks = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Percentage(50), // Left: Form
            Constraint::Percentage(50), // Right: Description + Listeners
        ])
        .split(chunks[0]);

    // Render the form
    if let Some(form) = report_form {
        form.render(f, main_chunks[0], state);
    }

    // Right side: description and listeners stacked
    let right_chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Percentage(50), // Description
            Constraint::Percentage(50), // Listeners
        ])
        .split(main_chunks[1]);

    render_description_panel(f, &right_chunks[0], state, selected_ext);
    render_listeners_panel(f, &right_chunks[1], state, selected_ext);
    render_help_text(f, &chunks[1], state, true);
}

fn render_description_panel(
    f: &mut Frame,
    area: &ratatui::layout::Rect,
    state: &AppState,
    selected_ext: Option<&crate::types::Extension>,
) {
    let (description, title, toggle_hint) = if let Some(ext) = selected_ext {
        // Check if we should show LLM description
        if ext.showing_llm_description && ext.llm_description.is_some() {
            let desc = ext.llm_description.as_ref().unwrap().clone();
            let hint = " [D] Show CWS Description";
            (desc, "Description (LLM Generated)", hint)
        } else if let Some(ref cws) = ext.cws_info {
            let desc = cws.description.clone();
            // Show toggle hint only if LLM description is available
            let hint = if ext.llm_description.is_some() {
                " [D] Show LLM Description"
            } else {
                ""
            };
            (desc, "Description (Chrome Web Store)", hint)
        } else {
            ("No description available".to_string(), "Description", "")
        }
    } else {
        ("No extension selected".to_string(), "Description", "")
    };

    let title_with_hint = format!("{}{}", title, toggle_hint);

    let desc_paragraph = Paragraph::new(description)
        .wrap(ratatui::widgets::Wrap { trim: true })
        .block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(Style::default().fg(state.theme.menubar_border))
                .title(title_with_hint),
        );

    f.render_widget(desc_paragraph, *area);
}

fn render_browser_cards(
    f: &mut Frame,
    area: &ratatui::layout::Rect,
    state: &AppState,
    mv2_browser_running: bool,
    mv3_browser_running: bool,
    event_count: u32,
) {
    let left_chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Percentage(50), Constraint::Percentage(50)])
        .split(*area);

    // V2 Card
    let v2_lines = vec![
        Line::from(Span::styled(
            if mv2_browser_running {
                "● Running"
            } else {
                "○ Stopped"
            },
            Style::default().fg(if mv2_browser_running {
                state.theme.status_running
            } else {
                state.theme.status_stopped
            }),
        )),
        Line::from(Span::raw("")),
        Line::from(Span::styled(
            format!("Events: {}", event_count),
            Style::default().fg(state.theme.analyzer_event_count),
        )),
    ];

    let v2_panel = Paragraph::new(v2_lines).block(
        Block::default()
            .borders(Borders::ALL)
            .title("V2")
            .border_style(Style::default().fg(state.theme.analyzer_v2_border)),
    );

    f.render_widget(v2_panel, left_chunks[0]);

    // V3 Card
    let v3_lines = vec![
        Line::from(Span::styled(
            if mv3_browser_running {
                "● Running"
            } else {
                "○ Stopped"
            },
            Style::default().fg(if mv3_browser_running {
                state.theme.status_running
            } else {
                state.theme.status_stopped
            }),
        )),
        Line::from(Span::raw("")),
        Line::from(Span::styled(
            format!("Events: {}", event_count),
            Style::default().fg(state.theme.analyzer_event_count),
        )),
    ];

    let v3_panel = Paragraph::new(v3_lines).block(
        Block::default()
            .borders(Borders::ALL)
            .title("V3")
            .border_style(Style::default().fg(state.theme.analyzer_v3_border)),
    );

    f.render_widget(v3_panel, left_chunks[1]);
}

fn render_extension_details(
    f: &mut Frame,
    area: &ratatui::layout::Rect,
    state: &AppState,
    selected_ext: Option<&crate::types::Extension>,
    _image_handler: &mut ImageHandler,
    image_protocols: &mut Vec<Option<StatefulProtocol>>,
) {
    if let Some(ext) = selected_ext {
        let center_chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Length(3),  // Extension name
                Constraint::Min(0),     // Metadata
                Constraint::Length(15), // Images
            ])
            .split(*area);

        // Extension name header
        let name_display = &ext.name;

        let name_text = Paragraph::new(Line::from(vec![Span::styled(
            name_display,
            Style::default()
                .fg(state.theme.analyzer_ext_name)
                .add_modifier(Modifier::BOLD),
        )]))
        .block(Block::default().borders(Borders::ALL));

        f.render_widget(name_text, center_chunks[0]);

        // Images area
        render_images(f, &center_chunks[2], state, ext, image_protocols);

        // Metadata area
        render_metadata(f, &center_chunks[1], state, ext);
    } else {
        let no_ext = Paragraph::new(vec![Line::from(Span::styled(
            "No extension selected",
            Style::default()
                .fg(state.theme.text_muted)
                .add_modifier(Modifier::DIM),
        ))])
        .block(Block::default().borders(Borders::ALL).title("Extension"));
        f.render_widget(no_ext, *area);
    }
}

fn render_images(
    f: &mut Frame,
    area: &ratatui::layout::Rect,
    state: &AppState,
    ext: &crate::types::Extension,
    image_protocols: &mut Vec<Option<StatefulProtocol>>,
) {
    if let Some(ref cws) = ext.cws_info {
        let image_count = cws.images.screenshots.len();

        if image_count > 0 {
            // Create dynamic constraints - divide horizontal space equally among all images
            let constraints: Vec<Constraint> = (0..image_count)
                .map(|_| Constraint::Ratio(1, image_count as u32))
                .collect();

            let icon_chunks = Layout::default()
                .direction(Direction::Horizontal)
                .constraints(constraints)
                .split(*area);

            // Render all images
            for (i, chunk) in icon_chunks.iter().enumerate() {
                if let Some(Some(protocol)) = image_protocols.get_mut(i) {
                    // We have a protocol - render the actual image with a border
                    let border = Block::default()
                        .borders(Borders::ALL)
                        .title(format!("Screenshot {}", i + 1));
                    let inner = border.inner(*chunk);
                    f.render_widget(border, *chunk);

                    // Render the image inside
                    let image_widget = StatefulImage::new();
                    f.render_stateful_widget(image_widget, inner, protocol);
                } else {
                    // No protocol yet - show placeholder
                    let has_image = i < cws.images.screenshots.len();
                    let icon_content = vec![
                        Line::from(Span::raw("")),
                        Line::from(Span::styled(
                            "  ▄▄▄",
                            Style::default().fg(if has_image {
                                state.theme.analyzer_image_placeholder
                            } else {
                                state.theme.text_muted
                            }),
                        )),
                        Line::from(Span::styled(
                            " █░░░█",
                            Style::default().fg(if has_image {
                                state.theme.analyzer_image_placeholder
                            } else {
                                state.theme.text_muted
                            }),
                        )),
                        Line::from(Span::styled(
                            " ▀▀▀▀▀",
                            Style::default().fg(if has_image {
                                state.theme.analyzer_image_placeholder
                            } else {
                                state.theme.text_muted
                            }),
                        )),
                        Line::from(Span::raw("")),
                        Line::from(Span::styled(
                            format!("Loading..."),
                            Style::default().fg(state.theme.analyzer_image_loading),
                        )),
                    ];

                    let icon = Paragraph::new(icon_content).block(
                        Block::default()
                            .borders(Borders::ALL)
                            .title(format!("Screenshot {}", i + 1)),
                    );
                    f.render_widget(icon, *chunk);
                }
            }
        } else {
            let no_images = Paragraph::new(vec![Line::from(Span::styled(
                "No screenshots available",
                Style::default()
                    .fg(state.theme.text_muted)
                    .add_modifier(Modifier::DIM),
            ))])
            .block(Block::default().borders(Borders::ALL).title("Images"));
            f.render_widget(no_images, *area);
        }
    } else {
        let no_cws = Paragraph::new(vec![Line::from(Span::styled(
            "No CWS data available",
            Style::default()
                .fg(state.theme.text_muted)
                .add_modifier(Modifier::DIM),
        ))])
        .block(Block::default().borders(Borders::ALL).title("Images"));
        f.render_widget(no_cws, *area);
    }
}

fn render_metadata(
    f: &mut Frame,
    area: &ratatui::layout::Rect,
    state: &AppState,
    ext: &crate::types::Extension,
) {
    let mut metadata_lines = vec![];

    if let Some(ref cws) = ext.cws_info {
        // Rating with stars
        if let Some(rating) = cws.details.rating.as_ref() {
            let rating_count_text = if let Some(count) = cws.details.rating_count.as_ref() {
                format!(" ({} ratings)", count)
            } else {
                String::new()
            };

            metadata_lines.push(Line::from(vec![
                Span::styled(
                    "Rating: ",
                    Style::default()
                        .fg(state.theme.analyzer_rating)
                        .add_modifier(Modifier::BOLD),
                ),
                Span::styled(
                    format!("{:.1}", rating),
                    Style::default().fg(state.theme.analyzer_rating),
                ),
                Span::raw(" "),
                Span::styled(
                    rating_count_text,
                    Style::default().fg(state.theme.text_muted),
                ),
            ]));
            metadata_lines.push(Line::from(Span::raw("")));
        }

        // User count
        if let Some(ref users) = cws.details.user_count {
            metadata_lines.push(Line::from(vec![
                Span::styled(
                    "Users: ",
                    Style::default()
                        .fg(state.theme.analyzer_user_count)
                        .add_modifier(Modifier::BOLD),
                ),
                Span::raw(users),
            ]));
            metadata_lines.push(Line::from(Span::raw("")));
        }

        // Version and size
        let version_text = cws
            .details
            .version
            .as_ref()
            .or(ext.version.as_ref())
            .map(|v| v.as_str())
            .unwrap_or("Unknown");
        metadata_lines.push(Line::from(vec![
            Span::styled(
                "Version: ",
                Style::default()
                    .fg(state.theme.analyzer_version_label)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::raw(version_text),
        ]));

        if let Some(ref size) = cws.details.size {
            metadata_lines.push(Line::from(vec![
                Span::styled(
                    "Size: ",
                    Style::default()
                        .fg(state.theme.analyzer_version_label)
                        .add_modifier(Modifier::BOLD),
                ),
                Span::raw(size),
            ]));
        }
        metadata_lines.push(Line::from(Span::raw("")));

        // Description
        metadata_lines.push(Line::from(Span::styled(
            "Description:",
            Style::default()
                .fg(state.theme.analyzer_description_label)
                .add_modifier(Modifier::BOLD),
        )));
        metadata_lines.push(Line::from(Span::raw(cws.description.as_str())));
        metadata_lines.push(Line::from(Span::raw("")));

        // Developer info
        if let Some(ref developer) = cws.details.developer {
            metadata_lines.push(Line::from(vec![
                Span::styled(
                    "Developer: ",
                    Style::default()
                        .fg(state.theme.analyzer_developer_label)
                        .add_modifier(Modifier::BOLD),
                ),
                Span::raw(developer),
            ]));
        }

        // Last updated
        if let Some(ref updated) = cws.details.updated {
            metadata_lines.push(Line::from(vec![
                Span::styled(
                    "Last Updated: ",
                    Style::default()
                        .fg(state.theme.analyzer_last_updated_label)
                        .add_modifier(Modifier::BOLD),
                ),
                Span::raw(updated),
            ]));
        }
    } else {
        // Show basic info without CWS data
        metadata_lines.push(Line::from(Span::styled(
            "No Chrome Web Store metadata available",
            Style::default().fg(state.theme.analyzer_no_cws_warning),
        )));
        metadata_lines.push(Line::from(Span::raw("")));

        if let Some(ref version) = ext.version {
            metadata_lines.push(Line::from(vec![
                Span::styled(
                    "Version: ",
                    Style::default()
                        .fg(state.theme.analyzer_version_label)
                        .add_modifier(Modifier::BOLD),
                ),
                Span::raw(version),
            ]));
        }
    }

    let metadata = Paragraph::new(metadata_lines)
        .wrap(ratatui::widgets::Wrap { trim: true })
        .block(
            Block::default()
                .borders(Borders::ALL)
                .title("Extension Info"),
        );
    f.render_widget(metadata, *area);
}

fn render_listeners_panel(
    f: &mut Frame,
    area: &ratatui::layout::Rect,
    state: &AppState,
    selected_ext: Option<&crate::types::Extension>,
) {
    let listener_items: Vec<Line> = if let Some(ext) = selected_ext {
        if ext.event_listeners.is_empty() {
            vec![Line::from(Span::styled(
                "No event listeners found",
                Style::default()
                    .fg(state.theme.text_muted)
                    .add_modifier(Modifier::DIM),
            ))]
        } else {
            ext.event_listeners
                .iter()
                .map(|listener| {
                    Line::from(vec![
                        Span::raw("  • "),
                        Span::styled(
                            &listener.api,
                            Style::default().fg(state.theme.analyzer_listener_api),
                        ),
                        Span::raw(" "),
                        Span::styled(
                            format!("({})", listener.file),
                            Style::default()
                                .fg(state.theme.analyzer_listener_file)
                                .add_modifier(Modifier::DIM),
                        ),
                    ])
                })
                .collect()
        }
    } else {
        vec![Line::from(Span::styled(
            "No extension selected",
            Style::default()
                .fg(state.theme.text_muted)
                .add_modifier(Modifier::DIM),
        ))]
    };

    let listeners_panel = Paragraph::new(listener_items).block(
        Block::default()
            .borders(Borders::ALL)
            .title("Registered Listeners")
            .border_style(Style::default().fg(state.theme.analyzer_listeners_border)),
    );

    f.render_widget(listeners_panel, *area);
}

fn render_status_bar(
    f: &mut Frame,
    area: &ratatui::layout::Rect,
    state: &AppState,
    selected_ext: Option<&crate::types::Extension>,
    event_count: u32,
) {
    let status_text = if let Some(ext) = selected_ext {
        Line::from(vec![
            Span::styled(
                "Extension ID: ",
                Style::default().fg(state.theme.analyzer_ext_name),
            ),
            Span::raw(ext.get_id()),
            Span::styled(" • ", Style::default().fg(state.theme.text_muted)),
            Span::styled(
                format!("Events Logged: {}", event_count),
                Style::default().fg(state.theme.status_running),
            ),
        ])
    } else {
        Line::from(Span::raw("No extension selected"))
    };

    let status = Paragraph::new(status_text).block(
        Block::default()
            .borders(Borders::ALL)
            .border_style(Style::default().fg(state.theme.analyzer_status_border)),
    );

    f.render_widget(status, *area);
}

fn render_help_text(
    f: &mut Frame,
    area: &ratatui::layout::Rect,
    state: &AppState,
    form_mode: bool,
) {
    let help_text = if form_mode {
        "Tab/Shift+Tab: Navigate • Space: Toggle • Type: Edit Notes • Enter: Submit • Esc: Cancel • D: Toggle Description"
    } else if state.selected_extension_id.is_some() {
        "Enter: Start Testing • O: Launch Both • Q: Close Both • N: Next • P: Previous • D: Toggle Description"
    } else {
        "No extension loaded • Go to Explorer tab and press 'A' to send an extension here"
    };
    let help = Paragraph::new(help_text).style(Style::default().add_modifier(Modifier::DIM));

    f.render_widget(help, *area);
}
