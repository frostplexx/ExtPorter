import React from 'react';
import { Box, Text } from 'ink';

export const SettingsTab: React.FC = () => {
    return (
        <Box flexDirection="column" width="100%" height="100%" paddingLeft={1}>
            {/* Title */}
            <Box marginBottom={1}>
                <Text bold color="cyan">
                    ⚙ Settings & Configuration
                </Text>
            </Box>

            {/* Server Configuration */}
            <Box flexDirection="column" marginBottom={1}>
                <Text bold underline>
                    Migration Server
                </Text>
                <Text>
                    <Text color="cyan">Server URL:</Text> ws://localhost:8080
                </Text>
            </Box>

            {/* Database Configuration */}
            <Box flexDirection="column" marginBottom={1}>
                <Text bold underline>
                    Database
                </Text>
                <Text>
                    <Text color="cyan">Type:</Text> MongoDB
                </Text>
                <Text>
                    <Text color="cyan">Host:</Text> localhost:27017
                </Text>
                <Text>
                    <Text color="cyan">Output:</Text> tmp/output
                </Text>
            </Box>

            {/* Features */}
            <Box flexDirection="column" marginBottom={1}>
                <Text bold underline>
                    Available Features
                </Text>
                <Text color="green">✓ WebSocket Migration Server</Text>
                <Text color="green">✓ Extension Analysis</Text>
                <Text color="green">✓ Database Integration</Text>
                <Text color="yellow">◇ Extension Testing (Coming Soon)</Text>
                <Text color="yellow">◇ Bulk Migration (Coming Soon)</Text>
            </Box>

            {/* About */}
            <Box flexDirection="column">
                <Text bold underline>
                    About
                </Text>
                <Text dimColor>Extension Analyzer & Migrator v1.0.0</Text>
                <Text dimColor>Migrate Chrome Extensions from Manifest V2 to V3</Text>
            </Box>
        </Box>
    );
};
