use ratatui::{
    layout::{Constraint, Direction, Layout},
    style::{Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Paragraph},
    Frame,
};
use ratatui_image::{protocol::StatefulProtocol, StatefulImage};
use tokio::sync::mpsc;

use crate::{app::AppState, listener_labels::get_listener_label, types::AppEvent};

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
    listeners_scroll_offset: &mut usize,
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
        render_form_mode(
            f,
            area,
            state,
            selected_ext,
            report_form,
            listeners_scroll_offset,
        );
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
            listeners_scroll_offset,
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
    listeners_scroll_offset: &mut usize,
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

            // Reset scroll offset when extension changes
            *listeners_scroll_offset = 0;

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
    render_listeners_panel(
        f,
        &main_chunks[2],
        state,
        selected_ext,
        listeners_scroll_offset,
    );
    render_status_bar(f, &chunks[1], state, selected_ext, event_count);
    render_help_text(f, &chunks[2], state, false);
}

fn render_form_mode(
    f: &mut Frame,
    area: ratatui::layout::Rect,
    state: &AppState,
    selected_ext: Option<&crate::types::Extension>,
    report_form: &mut Option<ReportForm>,
    listeners_scroll_offset: &mut usize,
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
    render_listeners_panel(
        f,
        &right_chunks[1],
        state,
        selected_ext,
        listeners_scroll_offset,
    );
    render_help_text(f, &chunks[1], state, true);
}

fn render_description_panel(
    f: &mut Frame,
    area: &ratatui::layout::Rect,
    state: &AppState,
    selected_ext: Option<&crate::types::Extension>,
) {
    let (description, title_text, toggle_hint, title_color) = if let Some(ext) = selected_ext {
        let ext_id = ext.get_id();

        // Check if currently generating - show animated spinner
        let generating_indicator = if state.llm_generating.contains(&ext_id) {
            // Animated spinner frames
            let spinner_frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
            let frame_idx = (std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis()
                / 100)
                % spinner_frames.len() as u128;
            format!(
                " {} Generating LLM description...",
                spinner_frames[frame_idx as usize]
            )
        } else {
            "".to_string()
        };

        // Check if we should show LLM description
        if ext.showing_llm_description && ext.llm_description.is_some() {
            let desc = ext.llm_description.as_ref().unwrap().clone();
            let hint = " [D] Show CWS Description";
            (
                desc,
                format!("Description (LLM Generated){}", generating_indicator),
                hint,
                state.theme.llm_description,
            )
        } else if let Some(ref cws) = ext.cws_info {
            let desc = cws.description.clone();
            // Show toggle hint only if LLM description is available
            let hint = if ext.llm_description.is_some() {
                " [D] Show LLM Description"
            } else if state.llm_generating.contains(&ext_id) {
                "" // No toggle while generating
            } else {
                ""
            };
            (
                desc,
                format!("Description (Chrome Web Store){}", generating_indicator),
                hint,
                state.theme.menubar_border,
            )
        } else if state.llm_generating.contains(&ext_id) {
            // Show spinner in description area if generating and no CWS description
            (
                format!("Generating LLM description, please wait...\n\nThis may take up to 3 minutes depending on the extension complexity."),
                format!("Description{}", generating_indicator),
                "",
                state.theme.menubar_border,
            )
        } else {
            (
                "No description available".to_string(),
                format!("Description{}", generating_indicator),
                "",
                state.theme.menubar_border,
            )
        }
    } else {
        (
            "No extension selected".to_string(),
            "Description".to_string(),
            "",
            state.theme.menubar_border,
        )
    };

    let title_with_hint = format!("{}{}", title_text, toggle_hint);

    let desc_paragraph = Paragraph::new(description)
        .wrap(ratatui::widgets::Wrap { trim: true })
        .block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(Style::default().fg(title_color))
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

    // V2 Card - Enhanced with purple theme
    let v2_status_text = if mv2_browser_running {
        "● Running"
    } else {
        "○ Stopped"
    };
    let v2_status_color = if mv2_browser_running {
        state.theme.status_running
    } else {
        state.theme.status_stopped
    };

    let v2_border_style = if mv2_browser_running {
        Style::default()
            .fg(state.theme.analyzer_v2_border)
            .add_modifier(Modifier::BOLD)
    } else {
        Style::default().fg(state.theme.analyzer_status_border)
    };

    let v2_lines = vec![
        Line::from(Span::styled(
            v2_status_text,
            Style::default()
                .fg(v2_status_color)
                .add_modifier(Modifier::BOLD),
        )),
        Line::from(Span::raw("")),
        Line::from(vec![
            Span::styled("Events: ", Style::default().fg(state.theme.text_muted)),
            Span::styled(
                format!("{}", event_count),
                Style::default()
                    .fg(state.theme.analyzer_event_count)
                    .add_modifier(Modifier::BOLD),
            ),
        ]),
    ];

    let v2_panel = Paragraph::new(v2_lines).block(
        Block::default()
            .borders(Borders::ALL)
            .title(Line::from(vec![
                Span::raw(" "),
                Span::styled("MV2", Style::default().add_modifier(Modifier::BOLD)),
                Span::raw(" "),
            ]))
            .border_style(v2_border_style),
    );

    f.render_widget(v2_panel, left_chunks[0]);

    // V3 Card - Enhanced with purple theme
    let v3_status_text = if mv3_browser_running {
        "● Running"
    } else {
        "○ Stopped"
    };
    let v3_status_color = if mv3_browser_running {
        state.theme.status_running
    } else {
        state.theme.status_stopped
    };

    let v3_border_style = if mv3_browser_running {
        Style::default()
            .fg(state.theme.analyzer_v3_border)
            .add_modifier(Modifier::BOLD)
    } else {
        Style::default().fg(state.theme.analyzer_status_border)
    };

    let v3_lines = vec![
        Line::from(Span::styled(
            v3_status_text,
            Style::default()
                .fg(v3_status_color)
                .add_modifier(Modifier::BOLD),
        )),
        Line::from(Span::raw("")),
        Line::from(vec![
            Span::styled("Events: ", Style::default().fg(state.theme.text_muted)),
            Span::styled(
                format!("{}", event_count),
                Style::default()
                    .fg(state.theme.analyzer_event_count)
                    .add_modifier(Modifier::BOLD),
            ),
        ]),
    ];

    let v3_panel = Paragraph::new(v3_lines).block(
        Block::default()
            .borders(Borders::ALL)
            .title(Line::from(vec![
                Span::raw(" "),
                Span::styled("MV3", Style::default().add_modifier(Modifier::BOLD)),
                Span::raw(" "),
            ]))
            .border_style(v3_border_style),
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

        // Description - show LLM or CWS based on toggle, with spinner while generating
        let ext_id = ext.get_id();
        let is_generating = state.llm_generating.contains(&ext_id);

        let (description_text, description_label, label_color) =
            if is_generating && ext.llm_description.is_none() {
                // Show spinner while generating (only if no LLM description exists yet)
                let spinner_frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
                let frame_idx = (std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_millis()
                    / 100)
                    % spinner_frames.len() as u128;

                (
                    format!(
                        "{} Generating LLM description...",
                        spinner_frames[frame_idx as usize]
                    ),
                    "Description:".to_string(),
                    state.theme.analyzer_description_label,
                )
            } else if ext.showing_llm_description && ext.llm_description.is_some() {
                (
                    ext.llm_description.as_ref().unwrap().clone(),
                    "Description (LLM):".to_string(),
                    state.theme.llm_description,
                )
            } else {
                (
                    cws.description.clone(),
                    "Description (CWS):".to_string(),
                    state.theme.analyzer_description_label,
                )
            };

        metadata_lines.push(Line::from(Span::styled(
            description_label.clone(),
            Style::default()
                .fg(label_color)
                .add_modifier(Modifier::BOLD),
        )));

        // Split description by newlines to preserve formatting
        let desc_lines: Vec<&str> = description_text.lines().collect();
        for line in desc_lines {
            metadata_lines.push(Line::from(Span::raw(line.to_string())));
        }
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
    scroll_offset: &mut usize,
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
                    let human_label = get_listener_label(&listener.api);
                    Line::from(vec![
                        Span::raw("  • "),
                        Span::styled(
                            human_label,
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

    // Calculate the available height for content (subtract 2 for borders)
    let content_height = area.height.saturating_sub(2) as usize;
    let total_items = listener_items.len();

    // Adjust scroll offset if needed
    if *scroll_offset > total_items.saturating_sub(content_height) {
        *scroll_offset = total_items.saturating_sub(content_height);
    }

    // Build title with scroll indicator if needed
    let title = if total_items > content_height {
        format!(
            "Registered Listeners ({}/{})",
            (*scroll_offset + content_height.min(total_items)),
            total_items
        )
    } else {
        "Registered Listeners".to_string()
    };

    let listeners_panel = Paragraph::new(listener_items)
        .scroll((*scroll_offset as u16, 0))
        .block(
            Block::default()
                .borders(Borders::ALL)
                .title(title)
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
    let help_line = if form_mode {
        Line::from(vec![
            Span::styled(
                "Tab/Shift+Tab: ",
                Style::default().add_modifier(Modifier::DIM),
            ),
            Span::styled("Navigate", Style::default()),
            Span::styled(" • ", Style::default().add_modifier(Modifier::DIM)),
            Span::styled("Space: ", Style::default().add_modifier(Modifier::DIM)),
            Span::styled("Toggle", Style::default()),
            Span::styled(" • ", Style::default().add_modifier(Modifier::DIM)),
            Span::styled(
                "S: ",
                Style::default()
                    .fg(state.theme.status_running)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::styled(
                "Submit",
                Style::default()
                    .fg(state.theme.status_running)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::styled(" • ", Style::default().add_modifier(Modifier::DIM)),
            Span::styled(
                "Esc: ",
                Style::default()
                    .fg(state.theme.status_stopped)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::styled(
                "Cancel",
                Style::default()
                    .fg(state.theme.status_stopped)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::styled(" • ", Style::default().add_modifier(Modifier::DIM)),
            Span::styled("D: ", Style::default().add_modifier(Modifier::DIM)),
            Span::styled("Toggle Description", Style::default()),
        ])
    } else if state.selected_extension_id.is_some() {
        Line::from(vec![
            Span::styled("▶ ", Style::default().fg(state.theme.status_running)),
            Span::styled(
                "Enter: ",
                Style::default()
                    .fg(state.theme.status_running)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::styled(
                "Start Testing",
                Style::default()
                    .fg(state.theme.status_running)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::styled(" • ", Style::default().add_modifier(Modifier::DIM)),
            Span::styled("O: ", Style::default().add_modifier(Modifier::DIM)),
            Span::styled("Launch Both", Style::default()),
            Span::styled(" • ", Style::default().add_modifier(Modifier::DIM)),
            Span::styled("Q: ", Style::default().add_modifier(Modifier::DIM)),
            Span::styled("Close Both", Style::default()),
            Span::styled(" • ", Style::default().add_modifier(Modifier::DIM)),
            Span::styled("N: ", Style::default().add_modifier(Modifier::DIM)),
            Span::styled("Next", Style::default()),
            Span::styled(" • ", Style::default().add_modifier(Modifier::DIM)),
            Span::styled("B: ", Style::default().add_modifier(Modifier::DIM)),
            Span::styled("Back", Style::default()),
            Span::styled(" • ", Style::default().add_modifier(Modifier::DIM)),
            Span::styled("D: ", Style::default().add_modifier(Modifier::DIM)),
            Span::styled("Toggle Description", Style::default()),
        ])
    } else {
        Line::from(vec![
            Span::styled(
                "No extension loaded",
                Style::default().add_modifier(Modifier::DIM),
            ),
            Span::styled(" • ", Style::default().add_modifier(Modifier::DIM)),
            Span::styled(
                "Go to Explorer tab and press 'A' to send an extension here",
                Style::default().add_modifier(Modifier::DIM),
            ),
        ])
    };

    let help = Paragraph::new(help_line);
    f.render_widget(help, *area);
}
