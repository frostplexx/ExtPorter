import React, { useEffect, useRef } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { useWebSocket } from '../websocket-context.js';
import { colors } from '../colors.js';

export const MigratorTab: React.FC = () => {
    const { messages, sendMessage, migrationStatus } = useWebSocket();
    const isRunning = migrationStatus === 'running';
    const { stdout } = useStdout();
    const lastMessageCount = useRef(0);

    // Calculate visible messages based on terminal height
    // Account for: Menu bar (3 lines with border), Footer (1 line)
    const terminalHeight = stdout?.rows || 24;
    const reservedLines = 5; // UI chrome: menu (3) + footer (1) + safety (1)
    const availableLines = Math.max(1, terminalHeight - reservedLines);
    const maxVisibleMessages = Math.max(5, availableLines);
    const visibleMessages = messages.slice(-maxVisibleMessages);

    // Calculate how many empty lines we need to fill the space
    // We want exactly enough lines to fill to the footer
    const emptyLineCount = Math.max(0, availableLines - visibleMessages.length);

    // Update last message count
    useEffect(() => {
        lastMessageCount.current = messages.length;
    }, [messages]);

    // Handle key inputs
    useInput((input, key) => {
        // Start migration
        if (input === 's' && !isRunning) {
            sendMessage('start');
        }
        // Stop migration
        else if (input === 'S' && isRunning) {
            sendMessage('stop');
        }
    });

    return (
        <Box flexDirection="column" width="100%" height="100%">
            {/* Messages - scrolling area */}
            <Box flexDirection="column" flexShrink={0}>
                {visibleMessages.map((msg, idx) => {
                    let prefix = '';
                    let color: 'green' | 'blue' | 'yellow' | 'white' | 'red' | 'cyan' | 'magenta' =
                        'green';

                    switch (msg.type) {
                        case 'sent':
                            prefix = '[INFO]';
                            color = 'magenta';
                            break;
                        case 'received':
                            prefix = '[INFO]';
                            color = 'magenta';
                            break;
                        case 'system':
                            // Check for log level prefixes
                            if (msg.content.startsWith('⚠') || msg.content.includes('[ERROR]')) {
                                prefix = '';
                                color = 'red';
                            } else if (msg.content.includes('[WARNING]')) {
                                prefix = '';
                                color = 'yellow';
                            } else if (msg.content.includes('[INFO]')) {
                                prefix = '';
                                color = 'cyan';
                            } else {
                                prefix = '';
                                color = 'white';
                            }
                            break;
                    }

                    // Truncate very long messages to prevent multi-line wrapping
                    const maxLength = (stdout?.columns || 80) - 5;
                    const content =
                        msg.content.length > maxLength
                            ? msg.content.substring(0, maxLength) + '...'
                            : msg.content;

                    return (
                        <Text
                            key={`msg-${msg.timestamp.getTime()}-${idx}`}
                            color={color}
                            wrap="truncate-end"
                        >
                            {prefix} {content}
                        </Text>
                    );
                })}

                {/* Fill with empty lines to push footer to bottom */}
                {Array.from({ length: emptyLineCount }).map((_, idx) => (
                    <Text key={`empty-${idx}`}> </Text>
                ))}
            </Box>

            {/* Footer with help text and status */}
            <Box flexShrink={0} backgroundColor={colors.purple}>
                {/* Left: Help text */}
                <Box flexShrink={0}>
                    <Text color={colors.text1}>
                        {isRunning ? '[S]top migration' : '[s]tart migration'}
                    </Text>
                </Box>

                {/* Spacer */}
                <Box flexGrow={1} />

                {/* Right: Migration status */}
                <Box flexShrink={0}>
                    <Text color={colors.text1}>
                        Status:{' '}
                        <Text color={isRunning ? 'green' : 'red'}>
                            {isRunning ? '● Running' : '○ Stopped'}
                        </Text>
                        <Text dimColor> ({messages.length} msgs)</Text>
                    </Text>
                </Box>
            </Box>
        </Box>
    );
};
