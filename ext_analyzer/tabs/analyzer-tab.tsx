import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';

// Mock database for now - will be replaced with actual database integration
interface MockExtension {
    id: string;
    name: string;
    score: number;
    hasMv3: boolean;
}

const mockExtensions: MockExtension[] = [
    { id: 'ext1', name: 'AdBlock Plus', score: 95.2, hasMv3: true },
    { id: 'ext2', name: 'LastPass', score: 88.7, hasMv3: false },
    { id: 'ext3', name: 'Grammarly', score: 92.1, hasMv3: true },
    { id: 'ext4', name: 'Honey', score: 76.4, hasMv3: false },
    { id: 'ext5', name: 'Dark Reader', score: 84.9, hasMv3: true },
];

interface ExtensionListItem {
    id: string;
    name: string;
    score: number;
    hasMv3: boolean;
}

export const AnalyzerTab: React.FC = () => {
    const [extensions, setExtensions] = useState<ExtensionListItem[]>([]);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [searchQuery, setSearchQuery] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [dbConnected, setDbConnected] = useState(false);

    useEffect(() => {
        loadExtensions();
    }, []);

    const loadExtensions = async () => {
        try {
            setLoading(true);
            setError(null);

            // Simulate database connection check
            const dbConnected = true; // Will be replaced with actual check
            setDbConnected(dbConnected);

            // Use mock data for now
            const extensionList: ExtensionListItem[] = mockExtensions.map((ext) => ({
                id: ext.id,
                name: ext.name,
                score: ext.score,
                hasMv3: ext.hasMv3,
            }));

            // Sort by interestingness score
            extensionList.sort((a, b) => b.score - a.score);

            setExtensions(extensionList);
            setLoading(false);
        } catch (err) {
            setError(
                `Error loading extensions: ${err instanceof Error ? err.message : String(err)}`
            );
            setLoading(false);
            setDbConnected(false);
        }
    };

    useInput((inputChar: string, key: any) => {
        // Don't handle tab navigation keys
        if (inputChar === '1' || inputChar === '2' || inputChar === '3') {
            return;
        }
        if (key.leftArrow || key.rightArrow) {
            return;
        }

        // Navigation
        if (key.upArrow) {
            setSelectedIndex((prev) => Math.max(0, prev - 1));
        } else if (key.downArrow) {
            setSelectedIndex((prev) => Math.min(filteredExtensions.length - 1, prev + 1));
        }

        // Search
        if (key.backspace || key.delete) {
            setSearchQuery((prev) => prev.slice(0, -1));
            setSelectedIndex(0);
        } else if (
            !key.ctrl &&
            !key.meta &&
            inputChar.length === 1 &&
            inputChar !== '1' &&
            inputChar !== '2' &&
            inputChar !== '3'
        ) {
            setSearchQuery((prev) => prev + inputChar);
            setSelectedIndex(0);
        }

        // Reload
        if (inputChar === 'r' && !key.ctrl) {
            loadExtensions();
        }
    });

    // Filter extensions based on search query
    const filteredExtensions = extensions.filter(
        (ext) =>
            ext.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            ext.id.toLowerCase().includes(searchQuery.toLowerCase())
    );

    // Display only 10 extensions at a time
    const displayExtensions = filteredExtensions.slice(0, 15);

    return (
        <Box flexDirection="column" width="100%" height="100%">
            {/* Status */}
            <Box marginBottom={1}>
                <Text>
                    Database:{' '}
                    <Text color={dbConnected ? 'green' : 'red'}>
                        {dbConnected ? 'Connected' : 'Disconnected'}
                    </Text>
                    {' • '}
                    Extensions: <Text color="cyan">{extensions.length}</Text>
                    {searchQuery && (
                        <>
                            {' • '}
                            Filtered: <Text color="yellow">{filteredExtensions.length}</Text>
                        </>
                    )}
                </Text>
            </Box>

            {/* Search Bar */}
            <Box borderStyle="round" borderColor="cyan" paddingX={1} marginBottom={1}>
                <Text color="gray">Search: </Text>
                <Text>{searchQuery}</Text>
                <Text color="gray">█</Text>
            </Box>

            {/* Extension List */}
            <Box
                flexDirection="column"
                borderStyle="round"
                borderColor="gray"
                paddingX={1}
                paddingY={0}
                flexGrow={1}
            >
                <Text bold underline color="cyan" dimColor>
                    Extensions (sorted by interestingness):
                </Text>

                {loading && <Text color="yellow">Loading extensions...</Text>}

                {error && <Text color="red">{error}</Text>}

                {!loading && !error && displayExtensions.length === 0 && (
                    <Text color="yellow">
                        {searchQuery
                            ? 'No extensions match your search'
                            : 'No extensions found in database'}
                    </Text>
                )}

                {!loading &&
                    !error &&
                    displayExtensions.map((ext, idx) => {
                        const isSelected = idx === selectedIndex;

                        return (
                            <Box key={ext.id}>
                                <Text
                                    bold={isSelected}
                                    color={isSelected ? 'cyan' : 'white'}
                                    backgroundColor={isSelected ? 'blue' : undefined}
                                >
                                    {isSelected ? '▶ ' : '  '}
                                    {ext.name.slice(0, 50)}
                                    {ext.name.length > 50 ? '...' : ''}{' '}
                                    <Text color="gray">(score: {ext.score.toFixed(1)})</Text>
                                    {ext.hasMv3 && <Text color="green"> ✓MV3</Text>}
                                </Text>
                            </Box>
                        );
                    })}

                {filteredExtensions.length > 15 && (
                    <Text color="gray" dimColor>
                        ... and {filteredExtensions.length - 15} more
                    </Text>
                )}
            </Box>

            {/* Help text */}
            <Box marginTop={1}>
                <Text dimColor>
                    Use ↑/↓ to navigate • Type to search • R to reload • ENTER to view details
                </Text>
            </Box>
        </Box>
    );
};
