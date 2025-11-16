import React from 'react';
import { Box, Text } from 'ink';
import { useWebSocket } from './websocket-context.js';
import { colors } from './colors.js';

type TabName = 'migrator' | 'analyzer' | 'settings';

interface MenuBarProps {
    activeTab: TabName;
    tabs: Array<{ name: TabName; label: string }>;
}

export const MenuBar: React.FC<MenuBarProps> = ({ activeTab, tabs }) => {
    const { connectionStatus, databaseStatus } = useWebSocket();

    const getStatusIcon = (status: 'connected' | 'disconnected' | 'connecting'): string => {
        switch (status) {
            case 'connected':
                return '●'; // Filled circle
            case 'connecting':
                return '◐'; // Half circle
            case 'disconnected':
                return '○'; // Empty circle
        }
    };

    const getStatusColor = (status: 'connected' | 'disconnected' | 'connecting'): string => {
        switch (status) {
            case 'connected':
                return 'green';
            case 'connecting':
                return 'yellow';
            case 'disconnected':
                return 'red';
        }
    };

    return (
        <Box
            flexDirection="column"
            width="100%"
            height="1px"
            flexGrow={1}
            borderStyle={'round'}
            borderColor={colors.purple}
        >
            {/* Menu Bar */}
            <Box width="100%">
                {/* Left: App Title */}
                <Box marginRight={2} flexShrink={0}>
                    <Text bold>ExtPorter</Text>
                </Box>

                {/* Center: Tabs */}
                <Box width="100%" flexGrow={1} justifyContent="center">
                    {tabs.map((tab, index) => {
                        const isActive = tab.name === activeTab;
                        return (
                            <Box key={tab.name} marginRight={2}>
                                <Text
                                    bold={isActive}
                                    color={isActive ? colors.text1 : colors.text1}
                                    backgroundColor={isActive ? colors.purple : undefined}
                                    dimColor={!isActive}
                                >
                                    {index + 1}. {tab.label}
                                </Text>
                            </Box>
                        );
                    })}
                </Box>

                {/* Spacer */}
                <Box flexGrow={1} />

                {/* Right: Status Indicators */}
                <Box flexShrink={0}>
                    <Text dimColor>Server: </Text>
                    <Text color={getStatusColor(connectionStatus)}>
                        {getStatusIcon(connectionStatus)}
                    </Text>
                    <Text dimColor>  Database: </Text>
                    <Text color={getStatusColor(databaseStatus)}>
                        {getStatusIcon(databaseStatus)} 
                    </Text>
                </Box>
            </Box>
        </Box>
    );
};
