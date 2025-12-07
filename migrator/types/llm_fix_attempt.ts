/**
 * Types for storing LLM fix attempts in the database
 */

/**
 * A single tool call made by the LLM during the fix process
 */
export interface LLMToolCall {
    tool: string; // Tool name (read_file, write_file, list_files)
    params: Record<string, any>; // Parameters passed to the tool
    result: {
        success: boolean;
        data?: any; // Tool result data
        error?: string;
    };
    timestamp: number;
}

/**
 * A file diff showing what the LLM changed
 */
export interface FileDiff {
    filePath: string;
    before: string | null; // null if file was created
    after: string;
    timestamp: number;
}

/**
 * A single message in the LLM conversation
 */
export interface LLMMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
    timestamp: number;
}

/**
 * Complete record of an LLM fix attempt
 */
export interface LLMFixAttempt {
    id: string; // Unique ID for this fix attempt
    extension_id: string; // Reference to Extension.id
    extension_name: string;
    report_id?: string; // Reference to Report.id (if available)

    // Timing
    started_at: number;
    completed_at: number;
    duration_ms: number;

    // Result
    success: boolean;
    message: string;
    error?: string;

    // Files modified
    files_modified: string[];

    // Complete conversation history
    conversation: LLMMessage[];

    // All tool calls made
    tool_calls: LLMToolCall[];

    // File diffs (before/after for each modified file)
    file_diffs: FileDiff[];

    // Iteration count
    iterations: number;

    // Model info
    model?: string;

    // Additional metadata
    metadata?: Record<string, any>;
}
