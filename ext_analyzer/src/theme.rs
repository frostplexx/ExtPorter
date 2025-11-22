use ratatui::style::Color;

/// Global color scheme configuration for the entire application
///
/// # Example
/// ```
/// use ratatui::style::Color;
///
/// let custom_theme = ColorScheme {
///     // Menu bar
///     tab_active: Color::LightRgb(88,70,120),
///     tab_inactive: Color::Gray,
///     connection_active: Color::LightGreen,
///     connection_connecting: Color::Rgb(255, 165, 0),
///     connection_disconnected: Color::LightRed,
///     
///     // Messages
///     msg_info: Color::Magenta,
///     msg_system_info: Color::Rgb(88,70,120),
///     msg_error: Color::LightRed,
///     msg_warning: Color::LightYellow,
///     msg_default: Color::White,
///     
///     // Status indicators
///     status_running: Color::LightGreen,
///     status_stopped: Color::LightRed,
///     
///     // UI elements
///     footer_background: Color::Rgb(50, 50, 50),
///     scroll_indicator: Color::LightYellow,
///     
///     // Confirmation dialog
///     dialog_border: Color::Magenta,
///     
///     // Explorer
///     stats_total: Color::Rgb(88,70,120),
///     stats_mv3: Color::LightGreen,
///     stats_mv2_only: Color::LightYellow,
///     stats_failed: Color::LightRed,
///     stats_avg_score: Color::Magenta,
///     search_border_active: Color::LightYellow,
///     search_border_inactive: Color::Gray,
///     search_label: Color::Gray,
///     search_cursor: Color::White,
///     item_selected_fg: Color::Rgb(88,70,120),
///     item_selected_bg: Color::Blue,
///     item_mv3_indicator: Color::LightGreen,
///     item_failed_indicator: Color::LightRed,
///     detail_label: Color::Rgb(88,70,120),
///     score_high: Color::LightGreen,
///     score_medium: Color::LightYellow,
///     score_low: Color::LightRed,
///     text_muted: Color::Gray,
///     analyzer_loaded_indicator: Color::LightYellow,
///     
///     // Analyzer tab
///     analyzer_v2_border: Color::Blue,
///     analyzer_v3_border: Color::LightRed,
///     // ... (other analyzer colors)
///     
///     // Database tab
///     database_label: Color::Rgb(88,70,120),
///     database_connected: Color::LightGreen,
///     // ... (other database colors)
///     
///     // Settings tab
///     settings_title: Color::Rgb(88,70,120),
///     settings_section_header: Color::White,
///     settings_label: Color::Rgb(88,70,120),
///     settings_feature_enabled: Color::LightGreen,
///     settings_about_text: Color::Gray,
///     settings_about_highlight: Color::Rgb(88,70,120),
/// };
/// ```
#[derive(Debug, Clone)]
pub struct ColorScheme {
    // Menu bar
    pub tab_active: Color,
    pub tab_inactive: Color,
    pub connection_active: Color,
    pub connection_connecting: Color,
    pub connection_disconnected: Color,

    // Messages
    pub msg_info: Color,
    pub msg_system_info: Color,
    pub msg_error: Color,
    pub msg_warning: Color,
    pub msg_default: Color,

    // Status indicators
    pub status_running: Color,
    pub status_stopped: Color,

    // UI elements
    pub footer_background: Color,
    pub scroll_indicator: Color,

    // Confirmation dialog
    pub dialog_border: Color,

    // Explorer
    pub stats_total: Color,
    pub stats_mv3: Color,
    pub stats_mv2_only: Color,
    pub stats_failed: Color,
    pub stats_avg_score: Color,
    pub search_border_active: Color,
    pub search_border_inactive: Color,
    pub search_label: Color,
    pub search_cursor: Color,
    pub item_selected_fg: Color,
    pub item_selected_bg: Color,
    pub item_mv3_indicator: Color,
    pub item_failed_indicator: Color,
    pub detail_label: Color,
    pub score_high: Color,                // Interestingness > 80
    pub score_medium: Color,              // Interestingness > 50
    pub score_low: Color,                 // Interestingness <= 50
    pub text_muted: Color,                // Gray text for empty states
    pub analyzer_loaded_indicator: Color, // Yellow indicator for loaded extensions

    // Analyzer
    pub analyzer_v2_border: Color,
    pub analyzer_v3_border: Color,
    pub analyzer_event_count: Color,
    pub analyzer_ext_name: Color,
    pub analyzer_image_loading: Color,
    pub analyzer_image_placeholder: Color,
    pub analyzer_rating: Color,
    pub analyzer_user_count: Color,
    pub analyzer_version_label: Color,
    pub analyzer_description_label: Color,
    pub analyzer_developer_label: Color,
    pub analyzer_last_updated_label: Color,
    pub analyzer_no_cws_warning: Color,
    pub analyzer_listener_api: Color,
    pub analyzer_listener_file: Color,
    pub analyzer_status_border: Color,
    pub analyzer_listeners_border: Color,

    // Database
    pub database_label: Color,
    pub database_connected: Color,
    pub database_disconnected: Color,
    pub database_mode: Color,
    pub database_border: Color,
    pub database_query_label: Color,
    pub database_query_text: Color,
    pub database_info_message: Color,
    pub database_info_dim: Color,

    // Settings
    pub settings_title: Color,
    pub settings_section_header: Color,
    pub settings_label: Color,
    pub settings_feature_enabled: Color,
    pub settings_about_text: Color,
    pub settings_about_highlight: Color,
}

impl Default for ColorScheme {
    fn default() -> Self {
        Self {
            // Menu bar
            tab_active: Color::Rgb(88,70,120),
            tab_inactive: Color::White,
            connection_active: Color::Green,
            connection_connecting: Color::Rgb(255, 165, 0), // Orange
            connection_disconnected: Color::Red,

            // Messages
            msg_info: Color::Magenta,
            msg_system_info: Color::Rgb(88,70,120),
            msg_error: Color::Red,
            msg_warning: Color::Yellow,
            msg_default: Color::White,

            // Status indicators
            status_running: Color::Green,
            status_stopped: Color::Red,

            // UI elements
            footer_background: Color::Rgb(88, 70, 120),
            scroll_indicator: Color::Yellow,

            // Confirmation dialog
            dialog_border: Color::Yellow,

            // Explorer
            stats_total: Color::Rgb(88,70,120),
            stats_mv3: Color::Green,
            stats_mv2_only: Color::Yellow,
            stats_failed: Color::Red,
            stats_avg_score: Color::Magenta,
            search_border_active: Color::Yellow,
            search_border_inactive: Color::Gray,
            search_label: Color::Gray,
            search_cursor: Color::White,
            item_selected_fg: Color::Rgb(88,70,120),
            item_selected_bg: Color::Blue,
            item_mv3_indicator: Color::Green,
            item_failed_indicator: Color::Red,
            detail_label: Color::Rgb(88,70,120),
            score_high: Color::Green,
            score_medium: Color::Yellow,
            score_low: Color::Red,
            text_muted: Color::Gray,
            analyzer_loaded_indicator: Color::Yellow,

            // Analyzer
            analyzer_v2_border: Color::Blue,
            analyzer_v3_border: Color::Red,
            analyzer_event_count: Color::Gray,
            analyzer_ext_name: Color::Rgb(88,70,120),
            analyzer_image_loading: Color::DarkGray,
            analyzer_image_placeholder: Color::Rgb(88,70,120),
            analyzer_rating: Color::Yellow,
            analyzer_user_count: Color::Green,
            analyzer_version_label: Color::Rgb(88,70,120),
            analyzer_description_label: Color::Magenta,
            analyzer_developer_label: Color::Blue,
            analyzer_last_updated_label: Color::Gray,
            analyzer_no_cws_warning: Color::Yellow,
            analyzer_listener_api: Color::Yellow,
            analyzer_listener_file: Color::Gray,
            analyzer_status_border: Color::DarkGray,
            analyzer_listeners_border: Color::Magenta,

            // Database
            database_label: Color::Rgb(88,70,120),
            database_connected: Color::Green,
            database_disconnected: Color::Red,
            database_mode: Color::Magenta,
            database_border: Color::Gray,
            database_query_label: Color::Gray,
            database_query_text: Color::Rgb(88,70,120),
            database_info_message: Color::Yellow,
            database_info_dim: Color::Gray,

            // Settings
            settings_title: Color::Rgb(88,70,120),
            settings_section_header: Color::White,
            settings_label: Color::Rgb(88,70,120),
            settings_feature_enabled: Color::Green,
            settings_about_text: Color::Gray,
            settings_about_highlight: Color::Rgb(88,70,120),
        }
    }
}
