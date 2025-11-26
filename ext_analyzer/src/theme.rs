use ratatui::style::Color;

// Purple Color Palette - Unified theme based on custom purple Rgb(140, 64, 145)
#[derive(Debug, Clone)]
pub struct PurplePalette;

impl PurplePalette {
    // Core Purple Shades
    pub const DEEP_PURPLE: Color = Color::Rgb(75, 0, 130); // Indigo - backgrounds, selected items
    pub const ROYAL_PURPLE: Color = Color::Rgb(140, 64, 145); // Custom purple - primary accent
    pub const MEDIUM_PURPLE: Color = Color::Rgb(147, 51, 234); // Vibrant purple - highlights
    pub const LAVENDER: Color = Color::Rgb(180, 120, 200); // Light purple - secondary text
    pub const SOFT_LAVENDER: Color = Color::Rgb(220, 180, 230); // Very light - active elements
    pub const MAGENTA: Color = Color::Rgb(199, 21, 133); // Pink-purple - special highlights
    pub const VIOLET: Color = Color::Rgb(138, 43, 226); // Blue-violet - active states

    // Backgrounds & Borders
    pub const PURPLE_GRAY: Color = Color::Rgb(120, 100, 130); // Muted purple-gray - borders
    pub const DARK_PURPLE_BG: Color = Color::Rgb(40, 20, 50); // Very dark - backgrounds
    pub const LIGHT_PURPLE_BG: Color = Color::Rgb(60, 40, 70); // Dark purple - panel backgrounds

    // Semantic Colors (non-purple but important for clarity)
    pub const SUCCESS_GREEN: Color = Color::Rgb(34, 197, 94); // Modern green
    pub const ERROR_RED: Color = Color::Rgb(239, 68, 68); // Modern red
    pub const WARNING_AMBER: Color = Color::Rgb(251, 191, 36); // Amber/gold
    pub const INFO_CYAN: Color = Color::Rgb(103, 232, 249); // Cyan-blue
}

#[derive(Debug, Clone)]
pub struct ColorScheme {
    // Menu bar
    pub tab_active: Color,
    pub tab_inactive: Color,
    pub connection_active: Color,
    pub connection_connecting: Color,
    pub connection_disconnected: Color,
    pub menubar_border: Color,

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
    pub scroll_indicator: Color,

    // Confirmation dialog
    pub dialog_border: Color,

    // Explorer
    pub stats_total: Color,
    pub stats_mv3: Color,
    pub stats_mv2_only: Color,
    #[allow(dead_code)]
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
}

// Remove old CustomColors struct - replaced by PurplePalette
// (No code here - the CustomColors struct is deleted)

impl Default for ColorScheme {
    fn default() -> Self {
        Self {
            // Menu bar - Purple themed
            tab_active: PurplePalette::SOFT_LAVENDER,
            menubar_border: PurplePalette::ROYAL_PURPLE,
            tab_inactive: PurplePalette::PURPLE_GRAY,
            connection_active: PurplePalette::SUCCESS_GREEN,
            connection_connecting: PurplePalette::WARNING_AMBER,
            connection_disconnected: PurplePalette::ERROR_RED,

            // Messages - Color coded
            msg_info: PurplePalette::INFO_CYAN,
            msg_system_info: PurplePalette::LAVENDER,
            msg_error: PurplePalette::ERROR_RED,
            msg_warning: PurplePalette::WARNING_AMBER,
            msg_default: Color::White,

            // Status indicators
            status_running: PurplePalette::SUCCESS_GREEN,
            status_stopped: PurplePalette::ERROR_RED,

            // UI elements
            scroll_indicator: PurplePalette::MAGENTA,

            // Confirmation dialog
            dialog_border: PurplePalette::ROYAL_PURPLE,

            // Explorer - Purple accents
            stats_total: PurplePalette::ROYAL_PURPLE,
            stats_mv3: PurplePalette::SUCCESS_GREEN,
            stats_mv2_only: PurplePalette::WARNING_AMBER,
            stats_failed: PurplePalette::ERROR_RED,
            stats_avg_score: PurplePalette::VIOLET,
            search_border_active: PurplePalette::MEDIUM_PURPLE,
            search_border_inactive: PurplePalette::PURPLE_GRAY,
            search_label: PurplePalette::LAVENDER,
            search_cursor: Color::White,
            item_selected_fg: Color::White,
            item_selected_bg: PurplePalette::DEEP_PURPLE,
            item_mv3_indicator: PurplePalette::SUCCESS_GREEN,
            item_failed_indicator: PurplePalette::ERROR_RED,
            detail_label: PurplePalette::ROYAL_PURPLE,
            score_high: PurplePalette::SUCCESS_GREEN,
            score_medium: PurplePalette::WARNING_AMBER,
            score_low: PurplePalette::ERROR_RED,
            text_muted: PurplePalette::PURPLE_GRAY,
            analyzer_loaded_indicator: PurplePalette::MAGENTA,

            // Analyzer - Purple themed
            analyzer_v2_border: PurplePalette::VIOLET,
            analyzer_v3_border: PurplePalette::MAGENTA,
            analyzer_event_count: PurplePalette::LAVENDER,
            analyzer_ext_name: PurplePalette::SOFT_LAVENDER,
            analyzer_image_loading: PurplePalette::PURPLE_GRAY,
            analyzer_image_placeholder: PurplePalette::ROYAL_PURPLE,
            analyzer_rating: PurplePalette::WARNING_AMBER,
            analyzer_user_count: PurplePalette::SUCCESS_GREEN,
            analyzer_version_label: PurplePalette::LAVENDER,
            analyzer_description_label: PurplePalette::MEDIUM_PURPLE,
            analyzer_developer_label: PurplePalette::VIOLET,
            analyzer_last_updated_label: PurplePalette::PURPLE_GRAY,
            analyzer_no_cws_warning: PurplePalette::WARNING_AMBER,
            analyzer_listener_api: PurplePalette::SOFT_LAVENDER,
            analyzer_listener_file: PurplePalette::LAVENDER,
            analyzer_status_border: PurplePalette::PURPLE_GRAY,
            analyzer_listeners_border: PurplePalette::ROYAL_PURPLE,

            // Database - Purple themed
            database_label: PurplePalette::ROYAL_PURPLE,
            database_connected: PurplePalette::SUCCESS_GREEN,
            database_disconnected: PurplePalette::ERROR_RED,
            database_mode: PurplePalette::MEDIUM_PURPLE,
            database_border: PurplePalette::PURPLE_GRAY,
            database_query_label: PurplePalette::LAVENDER,
            database_query_text: PurplePalette::SOFT_LAVENDER,
            database_info_message: PurplePalette::INFO_CYAN,
            database_info_dim: PurplePalette::PURPLE_GRAY,
        }
    }
}
