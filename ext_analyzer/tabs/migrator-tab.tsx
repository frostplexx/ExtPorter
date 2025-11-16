import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { useWebSocket } from '../websocket-context.js';

export const MigratorTab: React.FC = () => {
    const { messages, connectionStatus, sendMessage } = useWebSocket();
    const [input, setInput] = useState('');

    useInput((inputChar: string, key: any) => {
        // Don't handle tab navigation keys
        if (inputChar === '1' || inputChar === '2' || inputChar === '3') {
            return;
        }
        if (key.leftArrow || key.rightArrow) {
            return;
        }

        if (key.return) {
            sendMessage(input);
            setInput('');
            return;
        }

        if (key.backspace || key.delete) {
            setInput((prev) => prev.slice(0, -1));
            return;
        }

        if (!key.ctrl && !key.meta && inputChar.length === 1) {
            setInput((prev) => prev + inputChar);
        }
    });

    const getStatusColor = (): 'green' | 'yellow' | 'red' => {
        switch (connectionStatus) {
            case 'connected':
                return 'green';
            case 'connecting':
                return 'yellow';
            case 'disconnected':
                return 'red';
        }
    };

    const getStatusText = (): string => {
        switch (connectionStatus) {
            case 'connected':
                return 'CONNECTED';
            case 'connecting':
                return 'CONNECTING';
            case 'disconnected':
                return 'DISCONNECTED';
        }
    };

    // Keep only last 15 messages for display
    const displayMessages = messages.slice(-15);

    return (
        <Box flexDirection="column" width="100%" height="100%">
            {/* Status Bar */}
            <Box marginBottom={1}>
                <Text bold color={getStatusColor()}>
                    Server Status: [{getStatusText()}]
                </Text>
            </Box>

            {/* Messages */}
            <Box
                flexDirection="column"
                borderStyle="round"
                borderColor="gray"
                paddingX={1}
                paddingY={0}
                flexGrow={1}
            >
                <Text bold underline color="cyan" dimColor>
                    Migration Server Messages:
                </Text>
                {displayMessages.map((msg, idx) => {
                    let prefix = '';
                    let color: 'green' | 'blue' | 'yellow' = 'green';

                    switch (msg.type) {
                        case 'sent':
                            prefix = '→';
                            color = 'green';
                            break;
                        case 'received':
                            prefix = '←';
                            color = 'blue';
                            break;
                        case 'system':
                            prefix = '•';
                            color = 'yellow';
                            break;
                    }

                    return (
                        <Text key={`msg-${msg.timestamp.getTime()}-${idx}`} color={color}>
                            {prefix} {msg.content}
                        </Text>
                    );
                })}
            </Box>

            {/* Input */}
            <Box borderStyle="round" borderColor="cyan" paddingX={1} marginTop={1}>
                <Text color="gray">{'> '}</Text>
                <Text>{input}</Text>
                <Text color="gray">█</Text>
            </Box>

            {/* Help text */}
            <Box marginTop={1}>
                <Text dimColor>Commands: migrate &lt;extension-id&gt; | stop | status</Text>
            </Box>
        </Box>
    );
};
