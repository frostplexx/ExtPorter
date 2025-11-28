use ratatui::style::Color;

// Catppuccin Mocha Color Palette
// Reference: https://github.com/catppuccin/catppuccin
#[derive(Debug, Clone)]
pub struct CatppuccinMocha;

impl CatppuccinMocha {
    // Base colors
    pub const BASE: Color = Color::Rgb(30, 30, 46); // #1e1e2e - main background
    pub const MANTLE: Color = Color::Rgb(24, 24, 37); // #181825 - darker background
    pub const CRUST: Color = Color::Rgb(17, 17, 27); // #11111b - darkest background

    // Surface colors
    pub const SURFACE0: Color = Color::Rgb(49, 50, 68); // #313244 - surface
    pub const SURFACE1: Color = Color::Rgb(69, 71, 90); // #45475a - lighter surface
    pub const SURFACE2: Color = Color::Rgb(88, 91, 112); // #585b70 - even lighter surface

    // Text colors
    pub const TEXT: Color = Color::Rgb(205, 214, 244); // #cdd6f4 - main text
    pub const SUBTEXT1: Color = Color::Rgb(186, 194, 222); // #bac2de - secondary text
    pub const SUBTEXT0: Color = Color::Rgb(166, 173, 200); // #a6adc8 - tertiary text
    pub const OVERLAY2: Color = Color::Rgb(147, 153, 178); // #9399b2 - muted text
    pub const OVERLAY1: Color = Color::Rgb(127, 132, 156); // #7f849c - more muted text
    pub const OVERLAY0: Color = Color::Rgb(108, 112, 134); // #6c7086 - very muted text

    // Accent colors
    pub const ROSEWATER: Color = Color::Rgb(245, 224, 220); // #f5e0dc - soft pink
    pub const FLAMINGO: Color = Color::Rgb(242, 205, 205); // #f2cdcd - pink
    pub const PINK: Color = Color::Rgb(245, 194, 231); // #f5c2e7 - bright pink
    pub const MAUVE: Color = Color::Rgb(203, 166, 247); // #cba6f7 - purple
    pub const RED: Color = Color::Rgb(243, 139, 168); // #f38ba8 - red
    pub const MAROON: Color = Color::Rgb(235, 160, 172); // #eba0ac - lighter red
    pub const PEACH: Color = Color::Rgb(250, 179, 135); // #fab387 - orange
    pub const YELLOW: Color = Color::Rgb(249, 226, 175); // #f9e2af - yellow
    pub const GREEN: Color = Color::Rgb(166, 227, 161); // #a6e3a1 - green
    pub const TEAL: Color = Color::Rgb(148, 226, 213); // #94e2d5 - teal
    pub const SKY: Color = Color::Rgb(137, 220, 235); // #89dceb - light blue
    pub const SAPPHIRE: Color = Color::Rgb(116, 199, 236); // #74c7ec - blue
    pub const BLUE: Color = Color::Rgb(137, 180, 250); // #89b4fa - bright blue
    pub const LAVENDER: Color = Color::Rgb(180, 190, 254); // #b4befe - lavender
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

impl Default for ColorScheme {
    fn default() -> Self {
        Self {
            // Menu bar - Catppuccin themed
            tab_active: CatppuccinMocha::MAUVE,
            menubar_border: CatppuccinMocha::LAVENDER,
            tab_inactive: CatppuccinMocha::OVERLAY0,
            connection_active: CatppuccinMocha::GREEN,
            connection_connecting: CatppuccinMocha::YELLOW,
            connection_disconnected: CatppuccinMocha::RED,

            // Messages - Color coded
            msg_info: CatppuccinMocha::SKY,
            msg_system_info: CatppuccinMocha::SUBTEXT1,
            msg_error: CatppuccinMocha::RED,
            msg_warning: CatppuccinMocha::PEACH,
            msg_default: CatppuccinMocha::TEXT,

            // Status indicators
            status_running: CatppuccinMocha::GREEN,
            status_stopped: CatppuccinMocha::RED,

            // UI elements
            scroll_indicator: CatppuccinMocha::PINK,

            // Confirmation dialog
            dialog_border: CatppuccinMocha::MAUVE,

            // Explorer - Catppuccin accents
            stats_total: CatppuccinMocha::LAVENDER,
            stats_mv3: CatppuccinMocha::GREEN,
            stats_mv2_only: CatppuccinMocha::YELLOW,
            stats_failed: CatppuccinMocha::RED,
            stats_avg_score: CatppuccinMocha::BLUE,
            search_border_active: CatppuccinMocha::MAUVE,
            search_border_inactive: CatppuccinMocha::SURFACE2,
            search_label: CatppuccinMocha::SUBTEXT1,
            search_cursor: CatppuccinMocha::TEXT,
            item_selected_fg: CatppuccinMocha::TEXT,
            item_selected_bg: CatppuccinMocha::SURFACE1,
            item_mv3_indicator: CatppuccinMocha::GREEN,
            item_failed_indicator: CatppuccinMocha::RED,
            detail_label: CatppuccinMocha::MAUVE,
            score_high: CatppuccinMocha::GREEN,
            score_medium: CatppuccinMocha::YELLOW,
            score_low: CatppuccinMocha::RED,
            text_muted: CatppuccinMocha::OVERLAY0,
            analyzer_loaded_indicator: CatppuccinMocha::PINK,

            // Analyzer - Catppuccin themed
            analyzer_v2_border: CatppuccinMocha::BLUE,
            analyzer_v3_border: CatppuccinMocha::PINK,
            analyzer_event_count: CatppuccinMocha::SUBTEXT1,
            analyzer_ext_name: CatppuccinMocha::MAUVE,
            analyzer_image_loading: CatppuccinMocha::OVERLAY1,
            analyzer_image_placeholder: CatppuccinMocha::LAVENDER,
            analyzer_rating: CatppuccinMocha::YELLOW,
            analyzer_user_count: CatppuccinMocha::GREEN,
            analyzer_version_label: CatppuccinMocha::SUBTEXT1,
            analyzer_description_label: CatppuccinMocha::MAUVE,
            analyzer_developer_label: CatppuccinMocha::BLUE,
            analyzer_last_updated_label: CatppuccinMocha::OVERLAY1,
            analyzer_no_cws_warning: CatppuccinMocha::PEACH,
            analyzer_listener_api: CatppuccinMocha::LAVENDER,
            analyzer_listener_file: CatppuccinMocha::SUBTEXT1,
            analyzer_status_border: CatppuccinMocha::SURFACE2,
            analyzer_listeners_border: CatppuccinMocha::LAVENDER,

            // Database - Catppuccin themed
            database_label: CatppuccinMocha::MAUVE,
            database_connected: CatppuccinMocha::GREEN,
            database_disconnected: CatppuccinMocha::RED,
            database_mode: CatppuccinMocha::LAVENDER,
            database_border: CatppuccinMocha::SURFACE2,
            database_query_label: CatppuccinMocha::SUBTEXT1,
            database_query_text: CatppuccinMocha::MAUVE,
            database_info_message: CatppuccinMocha::SKY,
            database_info_dim: CatppuccinMocha::OVERLAY0,
        }
    }
}
