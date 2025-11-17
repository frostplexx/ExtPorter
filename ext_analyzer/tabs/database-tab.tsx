import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { useWebSocket } from '../websocket-context.js';
import * as dotenv from 'dotenv';

dotenv.config();

interface Collection {
    name: string;
    count: number;
}

type QueryResult = any[] | null;

export const DatabaseTab: React.FC = () => {
    const { databaseStatus, client } = useWebSocket();
    const [collections, setCollections] = useState<Collection[]>([]);
    const [selectedCollectionIndex, setSelectedCollectionIndex] = useState(0);
    const [query, setQuery] = useState('{}');
    const [queryResult, setQueryResult] = useState<QueryResult>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [viewMode, setViewMode] = useState<'collections' | 'query'>('collections');
    const [cursorPosition, setCursorPosition] = useState(query.length);

    // Load collections on mount
    useEffect(() => {
        loadCollections();
    }, []);

    const loadCollections = async () => {
        try {
            if (!client.isConnected()) {
                setError('Not connected to server');
                return;
            }

            const collectionsData = await client.getCollections();
            setCollections(collectionsData);
        } catch (err) {
            setError(
                `Failed to load collections: ${err instanceof Error ? err.message : String(err)}`
            );
        }
    };

    const executeQuery = async () => {
        if (collections.length === 0) return;

        const selectedCollection = collections[selectedCollectionIndex];
        if (!selectedCollection) return;

        try {
            setLoading(true);
            setError(null);

            if (!client.isConnected()) {
                throw new Error('Not connected to server');
            }

            // Parse query
            let parsedQuery: any = {};
            try {
                parsedQuery = JSON.parse(query);
            } catch (e) {
                throw new Error('Invalid JSON query');
            }

            // Execute query via WebSocket
            const results = await client.queryCollection(
                selectedCollection.name,
                parsedQuery,
                10
            );

            setQueryResult(results);
            setLoading(false);
        } catch (err) {
            setError(`Query failed: ${err instanceof Error ? err.message : String(err)}`);
            setLoading(false);
        }
    };

    const quickQuery = async (queryType: 'all' | 'failed' | 'mv3') => {
        const queries: Record<string, string> = {
            all: '{}',
            failed: '{"tags": "migration-failed"}',
            mv3: '{"mv3_extension_id": {"$exists": true}}',
        };

        setQuery(queries[queryType]);
        setCursorPosition(queries[queryType].length);

        // Auto-execute after setting query
        setTimeout(() => executeQuery(), 100);
    };

    useInput((inputChar: string, key: any) => {
        // Don't handle tab navigation keys
        if (['1', '2', '3', '4', '5'].includes(inputChar)) {
            return;
        }
        if (key.leftArrow || key.rightArrow) {
            return;
        }

        // Toggle view mode
        if (inputChar === 'm' && !key.ctrl) {
            setViewMode((prev) => (prev === 'collections' ? 'query' : 'collections'));
            return;
        }

        if (viewMode === 'collections') {
            // Navigation in collections list
            if (key.upArrow) {
                setSelectedCollectionIndex((prev) => Math.max(0, prev - 1));
            } else if (key.downArrow) {
                setSelectedCollectionIndex((prev) => Math.min(collections.length - 1, prev + 1));
            }

            // Quick queries
            if (inputChar === 'a') quickQuery('all');
            if (inputChar === 'f') quickQuery('failed');
            if (inputChar === 'v') quickQuery('mv3');

            // Execute query
            if (key.return) {
                executeQuery();
            }

            // Reload collections
            if (inputChar === 'r') {
                loadCollections();
            }
        } else if (viewMode === 'query') {
            // Query editing mode
            if (key.backspace || key.delete) {
                if (cursorPosition > 0) {
                    setQuery(
                        (prev) => prev.slice(0, cursorPosition - 1) + prev.slice(cursorPosition)
                    );
                    setCursorPosition((prev) => prev - 1);
                }
            } else if (key.return) {
                executeQuery();
            } else if (key.escape) {
                setViewMode('collections');
            } else if (
                !key.ctrl &&
                !key.meta &&
                inputChar.length === 1 &&
                !['1', '2', '3', '4', '5'].includes(inputChar)
            ) {
                setQuery(
                    (prev) => prev.slice(0, cursorPosition) + inputChar + prev.slice(cursorPosition)
                );
                setCursorPosition((prev) => prev + 1);
            }
        }
    });

    const selectedCollection = collections[selectedCollectionIndex];

    return (
        <Box flexDirection="column" width="100%" height="100%">
            {/* Database Status */}
            <Box marginBottom={1} paddingX={1}>
                <Text>
                    <Text color="cyan">Database:</Text>{' '}
                    <Text
                        color={
                            databaseStatus === 'connected'
                                ? 'green'
                                : databaseStatus === 'connecting'
                                  ? 'yellow'
                                  : 'red'
                        }
                    >
                        {databaseStatus}
                    </Text>
                    {' • '}
                    <Text color="cyan">Collections:</Text> {collections.length}
                    {' • '}
                    <Text color="cyan">Mode:</Text>{' '}
                    <Text color="magenta">{viewMode === 'collections' ? 'Browse' : 'Query'}</Text>
                </Text>
            </Box>

            <Box flexDirection="row" flexGrow={1}>
                {/* Collections Panel (Left) */}
                <Box
                    flexDirection="column"
                    borderStyle="round"
                    borderColor="gray"
                    paddingX={1}
                    paddingY={0}
                    width="30%"
                    marginRight={1}
                >
                    <Text bold underline color="cyan" dimColor>
                        Collections:
                    </Text>

                    {collections.length === 0 ? (
                        <Text color="yellow">No collections found</Text>
                    ) : (
                        collections.map((col, idx) => {
                            const isSelected = idx === selectedCollectionIndex;
                            return (
                                <Box key={col.name}>
                                    <Text
                                        bold={isSelected}
                                        color={isSelected ? 'cyan' : 'white'}
                                        backgroundColor={
                                            isSelected && viewMode === 'collections'
                                                ? 'blue'
                                                : undefined
                                        }
                                    >
                                        {isSelected ? '▶ ' : '  '}
                                        {col.name}{' '}
                                        <Text color="gray" dimColor>
                                            ({col.count})
                                        </Text>
                                    </Text>
                                </Box>
                            );
                        })
                    )}
                </Box>

                {/* Query/Results Panel (Right) */}
                <Box
                    flexDirection="column"
                    borderStyle="round"
                    borderColor="gray"
                    paddingX={1}
                    paddingY={0}
                    width="70%"
                >
                    <Text bold underline color="cyan" dimColor>
                        Query & Results:
                    </Text>

                    {/* Query Input */}
                    <Box marginBottom={1}>
                        <Text color="gray">Query: </Text>
                        <Text
                            backgroundColor={viewMode === 'query' ? 'blue' : undefined}
                            color={viewMode === 'query' ? 'white' : 'cyan'}
                        >
                            {query}
                            {viewMode === 'query' && <Text color="white">█</Text>}
                        </Text>
                    </Box>

                    {selectedCollection && (
                        <Text color="gray" dimColor>
                            Collection: {selectedCollection.name}
                        </Text>
                    )}

                    {/* Error Display */}
                    {error && (
                        <Box marginTop={1}>
                            <Text color="red">{error}</Text>
                        </Box>
                    )}

                    {/* Loading State */}
                    {loading && (
                        <Box marginTop={1}>
                            <Text color="yellow">Executing query...</Text>
                        </Box>
                    )}

                    {/* Query Results */}
                    {queryResult && queryResult.length > 0 && (
                        <Box flexDirection="column" marginTop={1}>
                            <Text color="green">
                                Found {queryResult.length} result(s) (limited to 10):
                            </Text>
                            {queryResult.map((doc, idx) => (
                                <Box key={idx} flexDirection="column" marginTop={1}>
                                    <Text color="cyan">
                                        Document {idx + 1}:{' '}
                                        {doc.name || doc.id || doc._id?.toString() || 'N/A'}
                                    </Text>
                                    <Text color="gray" dimColor>
                                        {JSON.stringify(
                                            {
                                                id: doc.id,
                                                name: doc.name,
                                                version: doc.version,
                                                tags: doc.tags,
                                                interestingness: doc.interestingness,
                                            },
                                            null,
                                            2
                                        )
                                            .split('\n')
                                            .slice(0, 6)
                                            .join('\n')}
                                    </Text>
                                </Box>
                            ))}
                        </Box>
                    )}

                    {queryResult && queryResult.length === 0 && (
                        <Box marginTop={1}>
                            <Text color="yellow">No results found</Text>
                        </Box>
                    )}
                </Box>
            </Box>

            {/* Help text */}
            <Box marginTop={1}>
                <Text dimColor>
                    {viewMode === 'collections' ? (
                        <>
                            M: Toggle mode • ↑/↓: Select • ENTER: Execute • A: All • F: Failed • V:
                            MV3 • R: Reload
                        </>
                    ) : (
                        <>M: Toggle mode • Type: Edit query • ENTER: Execute • ESC: Back</>
                    )}
                </Text>
            </Box>
        </Box>
    );
};
