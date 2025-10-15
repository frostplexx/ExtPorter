import { Extension } from '../migrator/types/extension';

// Extension already has all the fields we need, just use it directly
export type ExtensionSearchResult = Extension;

export interface SearchOptions {
    minScore?: number;
    hasMv3?: boolean;
    noMv3?: boolean;
    permission?: string;
    pattern?: string;
    nameFilter?: string;
}

export interface MenuItem {
    icon: string;
    label: string;
    key: string;
}

export interface CommandResult {
    success: boolean;
    output: string;
    error?: string;
}
