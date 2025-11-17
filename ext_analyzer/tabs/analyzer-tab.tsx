import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { useWebSocket } from '../websocket-context.js';

interface ExtensionAnalysis {
    id: string;
    name: string;
    version: string;
    interestingness?: number;
    tags?: string[];
    features?: {
        usesWebRequest?: boolean;
        usesBackgroundPage?: boolean;
        usesServiceWorker?: boolean;
        usesOffscreenDocument?: boolean;
        usesDNR?: boolean;
        permissions?: string[];
    };
    migrationStatus?: 'not-started' | 'in-progress' | 'completed' | 'failed';
}

export const AnalyzerTab: React.FC = () => {
    const { extensions, databaseStatus } = useWebSocket();
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [searchQuery, setSearchQuery] = useState('');
    const [sortBy, setSortBy] = useState<'name' | 'interestingness' | 'version'>('interestingness');

    useInput((inputChar: string, key: any) => {
        // Don't handle tab navigation keys
        if (['1', '2', '3', '4', '5'].includes(inputChar)) {
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
            !['1', '2', '3', '4', '5'].includes(inputChar)
        ) {
            setSearchQuery((prev) => prev + inputChar);
            setSelectedIndex(0);
        }

        // Sort toggle
        if (inputChar === 's' && !key.ctrl) {
            setSortBy((prev) => {
                if (prev === 'interestingness') return 'name';
                if (prev === 'name') return 'version';
                return 'interestingness';
            });
        }
    });

    // Filter extensions based on search query
    const filteredExtensions = extensions.filter(
        (ext) =>
            ext.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            ext.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
            ext.tags?.some((tag) => tag.toLowerCase().includes(searchQuery.toLowerCase()))
    );

    // Sort extensions
    const sortedExtensions = [...filteredExtensions].sort((a, b) => {
        if (sortBy === 'name') {
            return a.name.localeCompare(b.name);
        } else if (sortBy === 'version') {
            return (a.version || '').localeCompare(b.version || '');
        } else {
            // Sort by interestingness (default)
            return (b.interestingness || 0) - (a.interestingness || 0);
        }
    });

    // Display only 15 extensions at a time
    const displayExtensions = sortedExtensions.slice(0, 15);

    // Get selected extension details
    const selectedExtension =
        selectedIndex >= 0 && selectedIndex < displayExtensions.length
            ? displayExtensions[selectedIndex]
            : null;

    // Calculate statistics
    const stats = {
        total: extensions.length,
        withMv3: extensions.filter((ext) => ext.mv3_extension_id).length,
        withMv2Only: extensions.filter((ext) => !ext.mv3_extension_id).length,
        failed: extensions.filter((ext) => ext.tags?.includes('migration-failed')).length,
        avgInterestingness:
            extensions.reduce((sum, ext) => sum + (ext.interestingness || 0), 0) /
            extensions.length,
    };

    return (
        <Box flexDirection="column" width="100%" height="100%">
            {/* Statistics Bar */}
            <Box marginBottom={1} paddingX={1}>
                <Text>
                    <Text color="cyan">Total:</Text> {stats.total}
                    {' • '}
                    <Text color="green">MV3:</Text> {stats.withMv3}
                    {' • '}
                    <Text color="yellow">MV2 Only:</Text> {stats.withMv2Only}
                    {' • '}
                    <Text color="red">Failed:</Text> {stats.failed}
                    {' • '}
                    <Text color="magenta">Avg Score:</Text> {stats.avgInterestingness.toFixed(1)}
                </Text>
            </Box>

            {/* Search Bar */}
            <Box borderStyle="round" borderColor="cyan" paddingX={1} marginBottom={1}>
                <Text color="gray">Search: </Text>
                <Text>{searchQuery}</Text>
                <Text color="gray">█</Text>
                <Text color="gray"> • Sort by: </Text>
                <Text color="cyan">{sortBy}</Text>
            </Box>

            <Box flexDirection="row" flexGrow={1}>
                {/* Extension List (Left Panel) */}
                <Box
                    flexDirection="column"
                    borderStyle="round"
                    borderColor="gray"
                    paddingX={1}
                    paddingY={0}
                    width="50%"
                    marginRight={1}
                >
                    <Text bold underline color="cyan" dimColor>
                        Extensions:
                    </Text>

                    {databaseStatus !== 'connected' && (
                        <Text color="yellow">Waiting for database connection...</Text>
                    )}

                    {databaseStatus === 'connected' && displayExtensions.length === 0 && (
                        <Text color="yellow">
                            {searchQuery
                                ? 'No extensions match your search'
                                : 'No extensions found'}
                        </Text>
                    )}

                    {databaseStatus === 'connected' &&
                        displayExtensions.map((ext, idx) => {
                            const isSelected = idx === selectedIndex;
                            const hasMv3 = !!ext.mv3_extension_id;
                            const isFailed = ext.tags?.includes('migration-failed');

                            return (
                                <Box key={ext.id}>
                                    <Text
                                        bold={isSelected}
                                        color={isSelected ? 'cyan' : 'white'}
                                        backgroundColor={isSelected ? 'blue' : undefined}
                                    >
                                        {isSelected ? '▶ ' : '  '}
                                        {ext.name.slice(0, 30)}
                                        {ext.name.length > 30 ? '...' : ''}
                                        {hasMv3 && <Text color="green"> ✓</Text>}
                                        {isFailed && <Text color="red"> ✗</Text>}
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

                {/* Details Panel (Right Panel) */}
                <Box
                    flexDirection="column"
                    borderStyle="round"
                    borderColor="gray"
                    paddingX={1}
                    paddingY={0}
                    width="50%"
                >
                    <Text bold underline color="cyan" dimColor>
                        Details:
                    </Text>

                    {!selectedExtension ? (
                        <Text color="gray" dimColor>
                            Select an extension to view details
                        </Text>
                    ) : (
                        <Box flexDirection="column">
                            <Text>
                                <Text bold color="cyan">
                                    Name:
                                </Text>{' '}
                                {selectedExtension.name}
                            </Text>
                            <Text>
                                <Text bold color="cyan">
                                    ID:
                                </Text>{' '}
                                {selectedExtension.id}
                            </Text>
                            <Text>
                                <Text bold color="cyan">
                                    Version:
                                </Text>{' '}
                                {selectedExtension.version || 'N/A'}
                            </Text>
                            <Text>
                                <Text bold color="cyan">
                                    Interestingness:
                                </Text>{' '}
                                <Text
                                    color={
                                        (selectedExtension.interestingness || 0) > 80
                                            ? 'green'
                                            : (selectedExtension.interestingness || 0) > 50
                                              ? 'yellow'
                                              : 'red'
                                    }
                                >
                                    {selectedExtension.interestingness?.toFixed(1) || 'N/A'}
                                </Text>
                            </Text>

                            {selectedExtension.mv3_extension_id && (
                                <Text>
                                    <Text bold color="green">
                                        ✓ MV3 Version Available
                                    </Text>
                                </Text>
                            )}

                            {selectedExtension.tags && selectedExtension.tags.length > 0 && (
                                <>
                                    <Text bold color="cyan" marginTop={1}>
                                        Tags:
                                    </Text>
                                    {selectedExtension.tags.map((tag) => (
                                        <Text key={tag}>
                                            {'  '}•{' '}
                                            <Text
                                                color={
                                                    tag.includes('failed')
                                                        ? 'red'
                                                        : tag.includes('success')
                                                          ? 'green'
                                                          : 'yellow'
                                                }
                                            >
                                                {tag}
                                            </Text>
                                        </Text>
                                    ))}
                                </>
                            )}

                            {selectedExtension.migration_time_seconds && (
                                <Text marginTop={1}>
                                    <Text bold color="cyan">
                                        Migration Time:
                                    </Text>{' '}
                                    {selectedExtension.migration_time_seconds.toFixed(2)}s
                                </Text>
                            )}

                            {selectedExtension.input_path && (
                                <Text>
                                    <Text bold color="cyan">
                                        Path:
                                    </Text>{' '}
                                    <Text dimColor>
                                        {selectedExtension.input_path.split('/').pop()}
                                    </Text>
                                </Text>
                            )}
                        </Box>
                    )}
                </Box>
            </Box>

            {/* Help text */}
            <Box marginTop={1}>
                <Text dimColor>↑/↓: Navigate • Type: Search • S: Toggle sort • ESC: Quit</Text>
            </Box>
        </Box>
    );
};
