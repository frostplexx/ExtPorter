use anyhow::Result;
use crossterm::event::{KeyCode, KeyEvent};
use ratatui::{
    layout::{Constraint, Direction, Layout},
    style::{Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Paragraph},
    Frame,
};
use ratatui_image::{protocol::StatefulProtocol, StatefulImage};
use tokio::sync::mpsc;

use super::image_handler::ImageHandler;
use crate::app::{AppEvent, AppState};

pub struct AnalyzerTab {
    search_query: String,
    sort_by: SortBy,
    mv2_browser_running: bool,
    mv3_browser_running: bool,
    event_count: u32,
    image_handler: ImageHandler,
    last_displayed_ext_id: Option<String>,
    // Store image protocols for rendering (dynamic number based on available images)
    image_protocols: Vec<Option<Box<dyn StatefulProtocol>>>,
}

#[derive(Clone, Copy)]
enum SortBy {
    Interestingness,
    Name,
    Version,
}

impl AnalyzerTab {
    pub fn new() -> Self {
        Self {
            search_query: String::new(),
            sort_by: SortBy::Interestingness,
            mv2_browser_running: false,
            mv3_browser_running: false,
            event_count: 0,
            image_handler: ImageHandler::new(),
            last_displayed_ext_id: None,
            image_protocols: Vec::new(),
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
        self.render_comparison_mode(f, area, state, tx);
    }

    fn handle_input(
        &mut self,
        key: KeyEvent,
        state: &mut AppState,
        tx: mpsc::UnboundedSender<AppEvent>,
    ) -> Result<()> {
        return self.handle_comparison_input(key, state, tx);
    }

    fn as_any_mut(&mut self) -> &mut dyn std::any::Any {
        self
    }
}

// Helper methods for AnalyzerTab
impl AnalyzerTab {
    fn render_comparison_mode(
        &mut self,
        f: &mut Frame,
        area: ratatui::layout::Rect,
        state: &AppState,
        tx: mpsc::UnboundedSender<AppEvent>,
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

        // Get selected extension by ID from AppState
        let selected_ext = if let Some(ref ext_id) = state.selected_extension_id {
            state.extensions.iter().find(|e| e.id == *ext_id)
        } else {
            None
        };

        // If extension changed, start downloading its images
        if let Some(ext) = selected_ext {
            if self.last_displayed_ext_id.as_ref() != Some(&ext.id) {
                self.last_displayed_ext_id = Some(ext.id.clone());

                // Reset the image handler's display state for the new extension
                self.image_handler.reset_for_extension(ext.id.clone());

                // Clear existing protocols and initialize based on number of images
                if let Some(ref cws) = ext.cws_info {
                    self.image_protocols = vec![None; cws.images.screenshots.len()];
                } else {
                    self.image_protocols.clear();
                }

                // Start downloading images if we have CWS info with images
                if let Some(ref cws) = ext.cws_info {
                    if !cws.images.screenshots.is_empty() {
                        self.image_handler
                            .start_downloading(ext.id.clone(), cws.images.screenshots.clone());
                    }
                }
            } else {
                // Same extension - check if we can create protocols for downloaded images
                if let Some(ref cws) = ext.cws_info {
                    // Ensure we have enough protocol slots
                    if self.image_protocols.len() < cws.images.screenshots.len() {
                        self.image_protocols.resize_with(cws.images.screenshots.len(), || None);
                    }

                    // Try to create protocols for all images
                    for (i, url) in cws.images.screenshots.iter().enumerate() {
                        if i < self.image_protocols.len() && self.image_protocols[i].is_none() {
                            if let Some(protocol) = self.image_handler.create_protocol(url) {
                                self.image_protocols[i] = Some(protocol);
                            }
                        }
                    }
                }
            }
        }

        // LEFT PANEL: V2 and V3 cards vertically stacked
        let left_chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints([Constraint::Percentage(50), Constraint::Percentage(50)])
            .split(main_chunks[0]);

        // V2 Card
        let v2_lines = vec![
            Line::from(Span::styled(
                if self.mv2_browser_running {
                    "● Running"
                } else {
                    "○ Stopped"
                },
                Style::default().fg(if self.mv2_browser_running {
                    state.theme.status_running
                } else {
                    state.theme.status_stopped
                }),
            )),
            Line::from(Span::raw("")),
            Line::from(Span::styled(
                format!("Events: {}", self.event_count),
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
                if self.mv3_browser_running {
                    "● Running"
                } else {
                    "○ Stopped"
                },
                Style::default().fg(if self.mv3_browser_running {
                    state.theme.status_running
                } else {
                    state.theme.status_stopped
                }),
            )),
            Line::from(Span::raw("")),
            Line::from(Span::styled(
                format!("Events: {}", self.event_count),
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

        // CENTER PANEL: Extension details with CWS metadata
        if let Some(ext) = selected_ext {
            let center_chunks = Layout::default()
                .direction(Direction::Vertical)
                .constraints([
                    Constraint::Length(3), // Extension name
                    Constraint::Min(0), // Metadata
                    Constraint::Length(15),    // Images
                ])
                .split(main_chunks[1]);

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

            // Images area - show actual images or placeholders
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
                        .split(center_chunks[2]);

                    // Render all images
                    for (i, chunk) in icon_chunks.iter().enumerate() {
                        if let Some(Some(protocol)) = self.image_protocols.get_mut(i) {
                            // We have a protocol - render the actual image with a border
                            // Render border separately
                            let border = Block::default()
                                .borders(Borders::ALL)
                                .title(format!("Screenshot {}", i + 1));
                            let inner = border.inner(*chunk);
                            f.render_widget(border, *chunk);

                            // Render the image inside
                            let image_widget = StatefulImage::new(None);
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
                    f.render_widget(no_images, center_chunks[1]);
                }
            } else {
                let no_cws = Paragraph::new(vec![Line::from(Span::styled(
                    "No CWS data available",
                    Style::default()
                        .fg(state.theme.text_muted)
                        .add_modifier(Modifier::DIM),
                ))])
                .block(Block::default().borders(Borders::ALL).title("Images"));
                f.render_widget(no_cws, center_chunks[1]);
            }

            // Metadata area
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

                // Description - prioritize full description over short description
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
            f.render_widget(metadata, center_chunks[1]);
        } else {
            let no_ext = Paragraph::new(vec![Line::from(Span::styled(
                "No extension selected",
                Style::default()
                    .fg(state.theme.text_muted)
                    .add_modifier(Modifier::DIM),
            ))])
            .block(Block::default().borders(Borders::ALL).title("Extension"));
            f.render_widget(no_ext, main_chunks[1]);
        };

        // RIGHT PANEL: Registered Listeners
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

        f.render_widget(listeners_panel, main_chunks[2]);

        // Bottom status bar - event data counter
        let status_text = if let Some(ext) = selected_ext {
            Line::from(vec![
                Span::styled(
                    "Extension ID: ",
                    Style::default().fg(state.theme.analyzer_ext_name),
                ),
                Span::raw(&ext.id),
                Span::styled(" • ", Style::default().fg(state.theme.text_muted)),
                Span::styled(
                    format!("Events Logged: {}", self.event_count),
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

        f.render_widget(status, chunks[1]);

        // Help text
        let help_text = if state.selected_extension_id.is_some() {
            "O: Launch Both • Q: Close Both"
        } else {
            "No extension loaded • Go to Explorer tab and press 'A' to send an extension here"
        };
        let help = Paragraph::new(help_text).style(Style::default().add_modifier(Modifier::DIM));

        f.render_widget(help, chunks[2]);
    }
}

// Helper methods for AnalyzerTab
impl AnalyzerTab {
    fn handle_comparison_input(
        &mut self,
        key: KeyEvent,
        state: &mut AppState,
        tx: mpsc::UnboundedSender<AppEvent>,
    ) -> Result<()> {
        match key.code {
            KeyCode::Char('o') | KeyCode::Char('O') => {
                // Launch both browsers using the selected extension from AppState
                if let Some(ref ext_id) = state.selected_extension_id {
                    if let Some(_ext) = state.extensions.iter().find(|e| e.id == *ext_id) {
                        let msg = format!("LAUNCH_DUAL:{}", ext_id);
                        let _ = tx.send(AppEvent::SendWebSocketMessage(msg));
                        self.mv2_browser_running = true;
                        self.mv3_browser_running = true;
                    }
                }
            }
            KeyCode::Char('q') | KeyCode::Char('Q') => {
                // Close both browsers
                self.mv2_browser_running = false;
                self.mv3_browser_running = false;
                let _ = tx.send(AppEvent::SendWebSocketMessage("CLOSE_BROWSERS".to_string()));
            }
            _ => {}
        }
        Ok(())
    }
}
