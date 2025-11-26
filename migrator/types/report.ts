export interface ListenerTestResult {
    api: string;
    file: string;
    line?: number;
    status: 'untested' | 'yes' | 'no';
}

export interface Report {
    id: string; // Unique report ID
    extension_id: string; // Reference to Extension.id
    tested: boolean; // Manual testing status
    created_at: number; // Timestamp when created
    updated_at: number; // Timestamp when last updated

    // Automatically collected
    verification_duration_secs?: number; // Time taken to verify

    // Quick assessment fields
    overall_working?: boolean; // Does it basically work?
    has_errors?: boolean; // Did you see errors?
    seems_slower?: boolean; // Noticeably slower?
    needs_login?: boolean; // Does it require login for testing?
    is_popup_broken?: boolean; // Is the popup broken? (only if has popup)
    is_settings_broken?: boolean; // Are the settings broken? (only if has settings)
    is_interesting?: boolean; // Is it interesting for research?
    notes?: string; // Optional notes

    // Per-listener testing
    listeners?: ListenerTestResult[]; // Test results for each listener

    // Extensibility - any additional custom fields
    [key: string]: any;
}
